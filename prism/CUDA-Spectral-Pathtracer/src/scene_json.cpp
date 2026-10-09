#include "scene_setup.h"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <stdexcept>
#include <sstream>
#include <string>
#include <unordered_map>

#include <nlohmann/json.hpp>

int add_sphere(Scene& scene, const Point3& center, float radius, int material_id);
int add_rectangle_xy(Scene& scene, float x0, float x1, float y0, float y1, float k, int material_id);
int add_rectangle_xz(Scene& scene, float x0, float x1, float z0, float z1, float k, int material_id);
int add_rectangle_yz(Scene& scene, float y0, float y1, float z0, float z1, float k, int material_id);
int add_triangle(Scene& scene, const Point3& v0, const Point3& v1, const Point3& v2, int material_id);
void add_triangular_prism(Scene& scene, const Point3& base_center, float base_size, float height, int material_id);
void add_box(Scene& scene, const Point3& p0, const Point3& p1, int material_id);
int add_material(Scene& scene, const MaterialData& material);
int add_lambertian_material(Scene& scene, const Color& albedo);

namespace {

struct Rotation {
    Vec3 axis = Vec3(0.0f, 1.0f, 0.0f);
    float angle_degrees = 0.0f;
};

MaterialData make_default_material(MaterialType type) {
    MaterialData material = {};
    material.type = type;
    material.albedo = Color(1.0f, 1.0f, 1.0f);
    material.fuzz = 0.0f;
    material.ior = 1.0f;
    material.dispersive = false;
    material.emission = Color(0.0f, 0.0f, 0.0f);
    material.spectral_function_id = SPECTRAL_PROFILE_RGB_RECONSTRUCTION;
    material.emission_spectrum_id = SPECTRAL_PROFILE_D65_WHITE;
    material.dispersion_A = 1.0f;
    material.dispersion_B = 0.0f;
    material.dispersion_C = 0.0f;
    material.absorption_density = 0.0f;
    material.absorption_color = Color(1.0f, 1.0f, 1.0f);
    material.absorption_spectrum_id = SPECTRAL_PROFILE_CONSTANT;
    return material;
}

bool nearly_neutral(const Color& value) {
    return std::fabs(value.x - value.y) < 1.0e-4f &&
           std::fabs(value.x - value.z) < 1.0e-4f;
}

bool has_rotation(const Rotation& rotation) {
    return std::fabs(rotation.angle_degrees) > 1.0e-5f && rotation.axis.length_squared() > 1.0e-8f;
}

Point3 rotate_point(const Point3& point, const Point3& pivot, const Rotation& rotation) {
    if (!has_rotation(rotation)) {
        return point;
    }

    const Vec3 axis = normalize(rotation.axis);
    const float radians = rotation.angle_degrees * M_PI / 180.0f;
    const float c = std::cos(radians);
    const float s = std::sin(radians);
    const Vec3 p = point - pivot;
    const Vec3 rotated = p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0f - c);
    return pivot + rotated;
}

float json_float(const nlohmann::json& value, const char* name) {
    if (!value.is_number()) {
        throw std::runtime_error(std::string(name) + " must be a number.");
    }
    return value.get<float>();
}

Vec3 json_vec3(const nlohmann::json& value, const char* name) {
    if (value.is_array() && value.size() == 3) {
        return Vec3(
            value.at(0).get<float>(),
            value.at(1).get<float>(),
            value.at(2).get<float>()
        );
    }
    if (value.is_object()) {
        return Vec3(
            value.at("x").get<float>(),
            value.at("y").get<float>(),
            value.at("z").get<float>()
        );
    }
    throw std::runtime_error(std::string(name) + " must be a vector3.");
}

Rotation rotation_from_json(const nlohmann::json& properties) {
    Rotation rotation;
    if (properties.contains("rotationAxis")) {
        rotation.axis = json_vec3(properties.at("rotationAxis"), "rotationAxis");
    }
    if (properties.contains("rotationAngleDeg")) {
        rotation.angle_degrees = json_float(properties.at("rotationAngleDeg"), "rotationAngleDeg");
    }
    if (properties.contains("rotation") && properties.at("rotation").is_object()) {
        const nlohmann::json& value = properties.at("rotation");
        if (value.contains("axis")) {
            rotation.axis = json_vec3(value.at("axis"), "rotation.axis");
        }
        rotation.angle_degrees = value.value("angleDeg", value.value("angleDegrees", rotation.angle_degrees));
    }
    return rotation;
}

nlohmann::json load_json_file(const std::string& filename) {
    std::ifstream input(filename);
    if (!input) {
        throw std::runtime_error("Could not open scene JSON: " + filename);
    }

    nlohmann::json value;
    input >> value;
    return value;
}

const nlohmann::json* find_first_object(const nlohmann::json& scene_json, const std::string& type) {
    if (!scene_json.contains("objects") || !scene_json.at("objects").is_array()) {
        return nullptr;
    }

    for (const nlohmann::json& object : scene_json.at("objects")) {
        if (object.is_object() && object.value("objectType", "") == type) {
            return &object;
        }
    }
    return nullptr;
}

int spectral_profile_from_json(const nlohmann::json& value, int fallback) {
    if (value.is_number_integer()) {
        return value.get<int>();
    }
    if (!value.is_string()) {
        return fallback;
    }

    const std::string profile = value.get<std::string>();
    if (profile == "rgb") return SPECTRAL_PROFILE_RGB_RECONSTRUCTION;
    if (profile == "constant") return SPECTRAL_PROFILE_CONSTANT;
    if (profile == "green-filter") return SPECTRAL_PROFILE_GREEN_FILTER;
    if (profile == "red-filter") return SPECTRAL_PROFILE_RED_FILTER;
    if (profile == "d65-white") return SPECTRAL_PROFILE_D65_WHITE;
    if (profile == "warm-blackbody") return SPECTRAL_PROFILE_WARM_BLACKBODY;
    if (profile == "cornell-white") return SPECTRAL_PROFILE_CORNELL_WHITE;
    if (profile == "cornell-green") return SPECTRAL_PROFILE_CORNELL_GREEN;
    if (profile == "cornell-red") return SPECTRAL_PROFILE_CORNELL_RED;
    if (profile == "cornell-light") return SPECTRAL_PROFILE_CORNELL_LIGHT;
    return fallback;
}

MaterialData material_from_json(const nlohmann::json& value) {
    if (!value.is_object()) {
        MaterialData material = make_default_material(LAMBERTIAN);
        material.albedo = Color(0.8f, 0.8f, 0.8f);
        return material;
    }

    const std::string type = value.value("type", "lambertian");
    MaterialData material = make_default_material(LAMBERTIAN);
    if (type == "metal") {
        material = make_default_material(METAL);
        material.fuzz = value.value("fuzz", 0.0f);
    } else if (type == "dielectric") {
        material = make_default_material(DIELECTRIC);
        material.ior = value.value("ior", 1.5f);
        material.dispersive = value.value("dispersive", false);
        material.dispersion_A = value.value("dispersionA", material.dispersive ? 1.5837f : material.ior);
        material.dispersion_B = value.value("dispersionB", material.dispersive ? 10800.0f : 0.0f);
        material.dispersion_C = value.value("dispersionC", 0.0f);
        material.absorption_density = value.value("absorptionDensity", 0.0f);
        if (value.contains("absorptionColor")) {
            material.absorption_color = json_vec3(value.at("absorptionColor"), "material.absorptionColor");
        }
        material.absorption_spectrum_id = spectral_profile_from_json(
            value.value("absorptionProfile", nlohmann::json("constant")),
            SPECTRAL_PROFILE_CONSTANT
        );
    } else if (type == "emissive") {
        material = make_default_material(EMISSIVE);
        material.emission = value.contains("emission")
            ? json_vec3(value.at("emission"), "material.emission")
            : Color(value.value("strength", 8.0f), value.value("strength", 8.0f), value.value("strength", 8.0f));
        material.emission_spectrum_id = spectral_profile_from_json(
            value.value("emissionProfile", nlohmann::json("d65-white")),
            nearly_neutral(material.emission) ? SPECTRAL_PROFILE_D65_WHITE : SPECTRAL_PROFILE_RGB_RECONSTRUCTION
        );
    } else if (type == "spectral") {
        material = make_default_material(SPECTRAL);
        material.spectral_function_id = spectral_profile_from_json(
            value.value("spectralProfile", nlohmann::json("rgb")),
            SPECTRAL_PROFILE_RGB_RECONSTRUCTION
        );
    }

    if (value.contains("albedo")) {
        material.albedo = json_vec3(value.at("albedo"), "material.albedo");
    }
    return material;
}

std::string material_reference_id(const nlohmann::json& value) {
    if (value.is_string()) {
        return value.get<std::string>();
    }
    if (!value.is_object()) {
        return "";
    }
    if (value.contains("$ref") && value.at("$ref").is_string()) {
        return value.at("$ref").get<std::string>();
    }
    if (value.contains("objectId") && value.at("objectId").is_string()) {
        return value.at("objectId").get<std::string>();
    }
    return "";
}

bool is_material_reference(const nlohmann::json& value) {
    return value.is_string()
        || (value.is_object()
            && ((value.contains("$ref") && value.at("$ref").is_string())
                || (value.contains("objectId") && value.at("objectId").is_string())));
}

int add_json_material(
    Scene& scene,
    const nlohmann::json& object_properties,
    const std::unordered_map<std::string, int>& material_ids
) {
    if (!object_properties.contains("material")) {
        return add_lambertian_material(scene, Color(0.8f, 0.8f, 0.8f));
    }

    const nlohmann::json& material = object_properties.at("material");
    const std::string reference_id = material_reference_id(material);
    if (reference_id.empty() && is_material_reference(material)) {
        return add_lambertian_material(scene, Color(0.8f, 0.8f, 0.8f));
    }
    if (!reference_id.empty()) {
        const auto found = material_ids.find(reference_id);
        if (found == material_ids.end()) {
            throw std::runtime_error("Material reference not found: " + reference_id);
        }
        return found->second;
    }

    return add_material(scene, material_from_json(material));
}

void add_quad(Scene& scene, Point3 a, Point3 b, Point3 c, Point3 d, int material_id) {
    add_triangle(scene, a, b, c, material_id);
    add_triangle(scene, a, c, d, material_id);
}

void add_rotated_rectangle(
    Scene& scene,
    const std::string& orientation,
    float min_a,
    float max_a,
    float min_b,
    float max_b,
    float k,
    int material_id,
    const Rotation& rotation
) {
    Point3 corners[4];
    Point3 pivot;
    if (orientation == "xy") {
        pivot = Point3((min_a + max_a) * 0.5f, (min_b + max_b) * 0.5f, k);
        corners[0] = Point3(min_a, min_b, k);
        corners[1] = Point3(max_a, min_b, k);
        corners[2] = Point3(max_a, max_b, k);
        corners[3] = Point3(min_a, max_b, k);
    } else if (orientation == "yz") {
        pivot = Point3(k, (min_a + max_a) * 0.5f, (min_b + max_b) * 0.5f);
        corners[0] = Point3(k, min_a, min_b);
        corners[1] = Point3(k, max_a, min_b);
        corners[2] = Point3(k, max_a, max_b);
        corners[3] = Point3(k, min_a, max_b);
    } else {
        pivot = Point3((min_a + max_a) * 0.5f, k, (min_b + max_b) * 0.5f);
        corners[0] = Point3(min_a, k, min_b);
        corners[1] = Point3(max_a, k, min_b);
        corners[2] = Point3(max_a, k, max_b);
        corners[3] = Point3(min_a, k, max_b);
    }

    for (Point3& corner : corners) {
        corner = rotate_point(corner, pivot, rotation);
    }
    add_quad(scene, corners[0], corners[1], corners[2], corners[3], material_id);
}

void add_rotated_prism(Scene& scene, const Point3& base_center, float base_size, float height, int material_id, const Rotation& rotation) {
    const float triangle_height = base_size * std::sqrt(3.0f) * 0.5f;
    const float r = base_size / std::sqrt(3.0f);

    Point3 base_vertices[3] = {
        Point3(base_center.x, base_center.y, base_center.z + r),
        Point3(base_center.x + base_size * 0.5f, base_center.y, base_center.z - triangle_height / 3.0f),
        Point3(base_center.x - base_size * 0.5f, base_center.y, base_center.z - triangle_height / 3.0f)
    };
    Point3 top_vertices[3];
    for (int i = 0; i < 3; i++) {
        top_vertices[i] = Point3(base_vertices[i].x, base_vertices[i].y + height, base_vertices[i].z);
        base_vertices[i] = rotate_point(base_vertices[i], base_center, rotation);
        top_vertices[i] = rotate_point(top_vertices[i], base_center, rotation);
    }

    add_triangle(scene, base_vertices[0], base_vertices[2], base_vertices[1], material_id);
    add_triangle(scene, top_vertices[0], top_vertices[1], top_vertices[2], material_id);
    for (int i = 0; i < 3; i++) {
        const int j = (i + 1) % 3;
        add_triangle(scene, base_vertices[i], base_vertices[j], top_vertices[i], material_id);
        add_triangle(scene, base_vertices[j], top_vertices[j], top_vertices[i], material_id);
    }
}

void add_rotated_box(Scene& scene, const Point3& min, const Point3& max, int material_id, const Rotation& rotation) {
    Point3 corners[8] = {
        Point3(min.x, min.y, min.z),
        Point3(max.x, min.y, min.z),
        Point3(max.x, max.y, min.z),
        Point3(min.x, max.y, min.z),
        Point3(min.x, min.y, max.z),
        Point3(max.x, min.y, max.z),
        Point3(max.x, max.y, max.z),
        Point3(min.x, max.y, max.z)
    };
    const Point3 pivot = (min + max) * 0.5f;
    for (Point3& corner : corners) {
        corner = rotate_point(corner, pivot, rotation);
    }

    add_quad(scene, corners[0], corners[1], corners[5], corners[4], material_id);
    add_quad(scene, corners[3], corners[7], corners[6], corners[2], material_id);
    add_quad(scene, corners[0], corners[3], corners[2], corners[1], material_id);
    add_quad(scene, corners[4], corners[5], corners[6], corners[7], material_id);
    add_quad(scene, corners[0], corners[4], corners[7], corners[3], material_id);
    add_quad(scene, corners[1], corners[2], corners[6], corners[5], material_id);
}

int obj_vertex_index_from_token(const std::string& token, int vertex_count) {
    const std::size_t slash = token.find('/');
    const std::string index_text = slash == std::string::npos ? token : token.substr(0, slash);
    if (index_text.empty()) {
        throw std::runtime_error("OBJ face contains an empty vertex index.");
    }

    const int index = std::stoi(index_text);
    const int resolved = index < 0 ? vertex_count + index : index - 1;
    if (resolved < 0 || resolved >= vertex_count) {
        throw std::runtime_error("OBJ face references a vertex outside the mesh.");
    }
    return resolved;
}

Point3 transform_obj_vertex(
    const Point3& vertex,
    const Point3& position,
    float size,
    const Vec3& scale,
    const Rotation& rotation
) {
    const Point3 scaled(vertex.x * size * scale.x, vertex.y * size * scale.y, vertex.z * size * scale.z);
    return rotate_point(scaled, Point3(0.0f, 0.0f, 0.0f), rotation) + position;
}

void add_obj_mesh(
    Scene& scene,
    const std::string& obj_content,
    const Point3& position,
    float size,
    const Vec3& scale,
    const Rotation& rotation,
    int material_id
) {
    std::vector<Point3> vertices;
    int triangle_count = 0;
    std::istringstream input(obj_content);
    std::string line;

    while (std::getline(input, line)) {
        std::istringstream line_stream(line);
        std::string tag;
        line_stream >> tag;
        if (tag == "v") {
            float x = 0.0f;
            float y = 0.0f;
            float z = 0.0f;
            if (!(line_stream >> x >> y >> z)) {
                throw std::runtime_error("OBJ vertex line must contain x, y and z.");
            }
            vertices.push_back(Point3(x, y, z));
        } else if (tag == "f") {
            std::vector<int> face_indices;
            std::string token;
            while (line_stream >> token) {
                face_indices.push_back(obj_vertex_index_from_token(token, static_cast<int>(vertices.size())));
            }
            if (face_indices.size() < 3) {
                throw std::runtime_error("OBJ face must reference at least three vertices.");
            }
            for (std::size_t i = 1; i + 1 < face_indices.size(); ++i) {
                add_triangle(
                    scene,
                    transform_obj_vertex(vertices[face_indices[0]], position, size, scale, rotation),
                    transform_obj_vertex(vertices[face_indices[i]], position, size, scale, rotation),
                    transform_obj_vertex(vertices[face_indices[i + 1]], position, size, scale, rotation),
                    material_id
                );
                ++triangle_count;
            }
        }
    }

    if (vertices.empty()) {
        throw std::runtime_error("OBJ mesh did not contain any vertices.");
    }
    if (triangle_count == 0) {
        throw std::runtime_error("OBJ mesh did not contain any faces.");
    }
}

std::string obj_content_from_json(const nlohmann::json& properties) {
    if (properties.contains("objContent") && properties.at("objContent").is_string()) {
        return properties.at("objContent").get<std::string>();
    }
    if (properties.contains("objFile") && properties.at("objFile").is_object()) {
        const nlohmann::json& file = properties.at("objFile");
        if (file.contains("content") && file.at("content").is_string()) {
            return file.at("content").get<std::string>();
        }
    }
    throw std::runtime_error("ObjMesh.objFile must contain uploaded OBJ content.");
}

}

void apply_render_settings_from_json_file(const std::string& filename, ImageProperties& img_props) {
    const nlohmann::json scene_json = load_json_file(filename);
    const nlohmann::json* settings_object = find_first_object(scene_json, "SpectralRenderSettings");
    if (!settings_object || !settings_object->contains("properties")) {
        return;
    }

    const nlohmann::json& properties = settings_object->at("properties");
    img_props.width = std::max(1, properties.value("imageWidth", img_props.width));
    img_props.height = std::max(1, properties.value("imageHeight", img_props.height));
    img_props.samples_per_pixel = std::max(1, properties.value("samplesPerPixel", img_props.samples_per_pixel));
    img_props.max_depth = std::max(1, properties.value("maxDepth", img_props.max_depth));
    img_props.spectral_samples = std::max(1, properties.value("spectralSamples", img_props.spectral_samples));
    img_props.lambda_min = properties.value("lambdaMinNm", img_props.lambda_min);
    img_props.lambda_max = properties.value("lambdaMaxNm", img_props.lambda_max);
    if (img_props.lambda_min >= img_props.lambda_max) {
        throw std::runtime_error("SpectralRenderSettings.lambdaMinNm must be smaller than lambdaMaxNm.");
    }
    img_props.num_pixels = img_props.width * img_props.height;
}

Scene create_scene_from_json_file(const std::string& filename, const ImageProperties& img_props) {
    const nlohmann::json scene_json = load_json_file(filename);
    if (!scene_json.contains("objects") || !scene_json.at("objects").is_array()) {
        throw std::runtime_error("Scene JSON must contain an objects array.");
    }

    Point3 lookfrom(0, 2, -6);
    Point3 lookat(0, 0.5f, 0);
    Vec3 vup(0, 1, 0);
    float vfov = 45.0f;
    float aperture = 0.0f;
    float focus_dist = 6.0f;
    if (const nlohmann::json* camera_object = find_first_object(scene_json, "Camera")) {
        const nlohmann::json& properties = camera_object->at("properties");
        lookfrom = json_vec3(properties.at("lookFrom"), "Camera.lookFrom");
        lookat = json_vec3(properties.at("lookAt"), "Camera.lookAt");
        vup = json_vec3(properties.value("up", nlohmann::json::array({0, 1, 0})), "Camera.up");
        vfov = properties.value("verticalFov", vfov);
        aperture = properties.value("aperture", aperture);
        focus_dist = properties.value("focusDistance", (lookfrom - lookat).length());
    }

    const float aspect_ratio = static_cast<float>(img_props.width) / static_cast<float>(img_props.height);
    Scene scene(Camera(lookfrom, lookat, vup, vfov, aspect_ratio, aperture, focus_dist), img_props);

    std::unordered_map<std::string, int> material_ids;
    for (const nlohmann::json& object : scene_json.at("objects")) {
        if (!object.is_object() || object.value("objectType", "") != "Material" || !object.contains("properties")) {
            continue;
        }

        const int material_id = add_material(scene, material_from_json(object.at("properties")));
        if (object.contains("objectId") && object.at("objectId").is_string()) {
            material_ids[object.at("objectId").get<std::string>()] = material_id;
        }
        if (object.contains("objectName") && object.at("objectName").is_string()) {
            material_ids[object.at("objectName").get<std::string>()] = material_id;
        }
    }

    for (const nlohmann::json& object : scene_json.at("objects")) {
        if (!object.is_object() || !object.contains("properties")) {
            continue;
        }

        const std::string object_type = object.value("objectType", "");
        const nlohmann::json& properties = object.at("properties");
        if (object_type == "SpectralRenderSettings" || object_type == "Camera" || object_type == "Material") {
            continue;
        }

        if (object_type == "Sphere") {
            const int material_id = add_json_material(scene, properties, material_ids);
            add_sphere(
                scene,
                json_vec3(properties.at("center"), "Sphere.center"),
                json_float(properties.at("radius"), "Sphere.radius"),
                material_id
            );
        } else if (object_type == "Rectangle") {
            const int material_id = add_json_material(scene, properties, material_ids);
            const std::string orientation = properties.value("orientation", "xz");
            const float k = json_float(properties.at("k"), "Rectangle.k");
            const float min_a = json_float(properties.at("minA"), "Rectangle.minA");
            const float max_a = json_float(properties.at("maxA"), "Rectangle.maxA");
            const float min_b = json_float(properties.at("minB"), "Rectangle.minB");
            const float max_b = json_float(properties.at("maxB"), "Rectangle.maxB");
            const Rotation rotation = rotation_from_json(properties);
            if (has_rotation(rotation)) {
                add_rotated_rectangle(scene, orientation, min_a, max_a, min_b, max_b, k, material_id, rotation);
            } else if (orientation == "xy") {
                add_rectangle_xy(scene, min_a, max_a, min_b, max_b, k, material_id);
            } else if (orientation == "yz") {
                add_rectangle_yz(scene, min_a, max_a, min_b, max_b, k, material_id);
            } else {
                add_rectangle_xz(scene, min_a, max_a, min_b, max_b, k, material_id);
            }
        } else if (object_type == "TriangularPrism") {
            const int material_id = add_json_material(scene, properties, material_ids);
            const Point3 base_center = json_vec3(properties.at("baseCenter"), "TriangularPrism.baseCenter");
            const float base_size = json_float(properties.at("baseSize"), "TriangularPrism.baseSize");
            const float height = json_float(properties.at("height"), "TriangularPrism.height");
            const Rotation rotation = rotation_from_json(properties);
            if (has_rotation(rotation)) {
                add_rotated_prism(scene, base_center, base_size, height, material_id, rotation);
            } else {
                add_triangular_prism(scene, base_center, base_size, height, material_id);
            }
        } else if (object_type == "Box") {
            const int material_id = add_json_material(scene, properties, material_ids);
            const Point3 min = json_vec3(properties.at("min"), "Box.min");
            const Point3 max = json_vec3(properties.at("max"), "Box.max");
            const Rotation rotation = rotation_from_json(properties);
            if (has_rotation(rotation)) {
                add_rotated_box(scene, min, max, material_id, rotation);
            } else {
                add_box(scene, min, max, material_id);
            }
        } else if (object_type == "ObjMesh") {
            const int material_id = add_json_material(scene, properties, material_ids);
            add_obj_mesh(
                scene,
                obj_content_from_json(properties),
                json_vec3(properties.value("position", nlohmann::json::array({0, 0, 0})), "ObjMesh.position"),
                properties.value("size", 1.0f),
                json_vec3(properties.value("scale", nlohmann::json::array({1, 1, 1})), "ObjMesh.scale"),
                rotation_from_json(properties),
                material_id
            );
        }
    }

    if (scene.objects.empty()) {
        throw std::runtime_error("Scene JSON did not define any renderable objects.");
    }

    return scene;
}
