//
// Created by Cecilia on 02.06.2026.
//

#include "geometry.h"
#include <cmath>
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>
#include <array>
#include <iostream>
#include <ostream>

float degToRad(float deg) {
    return deg * glm::pi<float>() / 180.0f;
}

// Rotiert 2D Vektor um Winkel (Grad)
glm::vec2 rotate2D(glm::vec2 v, float angleDeg) {
    float angleRad = degToRad(angleDeg);

    float c = std::cos(angleRad);
    float s = std::sin(angleRad);

    return glm::vec2{
        c * v.x - s * v.y,
        s * v.x + c * v.y
    };
}

// Konstruiert drei Ebenen aus Prisma-Beschreibung
std::vector<Plane> buildPrismPlanes(const Prism2D& prism) {
    float alpha = degToRad(prism.prismAngleDeg);
    float halfAlpha = 0.5f * alpha;

    // Berechne lokale Eckpunkte des Dreiecks relativ zur Spitze.
    glm::vec2 apex{     // Spitze
        0.0f,
        0.0f
    };
    glm::vec2 baseLeft{
        -prism.radius * std::sin(halfAlpha),
        -prism.radius * std::cos(halfAlpha)
    };
    glm::vec2 baseRight{
        prism.radius * std::sin(halfAlpha),
        -prism.radius * std::cos(halfAlpha)
    };

    // Berechne Eckpunkte inkl. Prismaposition & -rotation
    std::array<glm::vec2, 3> verts = {
        rotate2D(apex, prism.rotationDeg) + prism.position,
        rotate2D(baseLeft, prism.rotationDeg) + prism.position,
        rotate2D(baseRight, prism.rotationDeg) + prism.position
    };

    // Initialisiere Ebenen
    std::vector<Plane> planes;

    for (int i = 0; i < 3; i++) {
        // Kante des Dreiecks
        glm::vec2 a = verts[i];
        glm::vec2 b = verts[(i + 1) % 3];

        glm::vec2 edge = b - a;
        float edgeLength = glm::length(edge);
        glm::vec2 edgeDir = glm::normalize(edge);

        // Normale der Kante
        glm::vec2 normal{
            edgeDir.y,
            -edgeDir.x
        };

        // Mittelpunkt der Kante
        glm::vec2 midpoint = 0.5f * (a + b);

        // Ebene erstellen mit z-Position 0
        planes.push_back(Plane{
            glm::vec3{midpoint.x, midpoint.y, 0.0f},
            glm::vec3{normal.x, normal.y, 0.0f},
            glm::vec3{0.0f, 0.0f, 1.0f},
            glm::vec3{-edgeDir.x, -edgeDir.y, 0.0f},
            prism.zDepth,
            edgeLength
        });
    }

    return planes;
}

bool intersectPlane(
    const Ray& ray,
    const Plane& plane,
    float& t,
    glm::vec3& hitPoint
) {
    // falls denom ~0 -> Ray parallel zur Plane, kein Schnittpunkt
    float denom = glm::dot(ray.direction, plane.normal);

    if (std::abs(denom) < 1e-6f) {
        return false;
    }

    // t = Stelle des Rays, an der der SP liegt
    t = glm::dot(plane.point - ray.origin, plane.normal) / denom;

    // SP "hinter" der Lichtquelle?
    if (t < 0.0f) {
        return false;
    }

    hitPoint = ray.origin + t * ray.direction;
    return true;
}

bool isPointOnPlaneRect(
    const glm::vec3& point,
    const Plane& plane
) {
    glm::vec3 local = point - plane.point;

    float u = glm::dot(local, plane.right);
    float v = glm::dot(local, plane.up);

    return
        u >= -plane.width * 0.5f && u <= plane.width * 0.5f &&
        v >= -plane.height * 0.5f && v <= plane.height * 0.5f;
}
