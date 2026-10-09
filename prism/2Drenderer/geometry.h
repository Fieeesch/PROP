//
// Created by Cecilia on 02.06.2026.
//

#ifndef RENDERER_2D_GEOMETRY_H
#define RENDERER_2D_GEOMETRY_H

#pragma once

#include <glm/glm.hpp>
#include <vector>

struct Prism2D {
    glm::vec2 position;      // Umkreismittelpunkt in xy
    float prismAngleDeg;     // Spitzenwinkel in Grad
    float rotationDeg;       // Rotation in Grad
    float radius;            // Umkreismittelpunkt -> Eckpunkt
    float zDepth;            // Tiefe entlang z
};

struct Ray {
    glm::vec3 origin;
    glm::vec3 direction;
    float wavelength;
    int wavelengthBin;
    float intensity;
};

struct Plane {
    glm::vec3 point;
    glm::vec3 normal;
    glm::vec3 right;
    glm::vec3 up;
    float width;
    float height;
};

struct AreaLight {
    glm::vec3 center;
    glm::vec3 direction;
    glm::vec3 right;
    glm::vec3 up;
    float width;
    float height;
};

struct CircleLight
{
    glm::vec3 center;
    glm::vec3 direction;
    glm::vec3 right;
    glm::vec3 up;
    float radius;
};

struct SpotLight
{
    glm::vec3 position;
    glm::vec3 direction;
    glm::vec3 right;
    glm::vec3 up;
    float coneAngleRadians; // halber Kegelwinkel
};

// Rotiert Vektor um Winkel (Rad)
glm::vec2 rotate2D(glm::vec2 v, float angle);

// Konstruiert drei Ebenen aus Prisma-Beschreibung
std::vector<Plane> buildPrismPlanes(const Prism2D& prism);

// Schneidet Ray mit Ebene. Gibt true & Schnittpunkt zurück, falls geschnitten. False falls nicht.
bool intersectPlane(
    const Ray& ray,
    const Plane& plane,
    float& t,
    glm::vec3& hitPoint
);

bool isPointOnPlaneRect(
    const glm::vec3& point,
    const Plane& plane
);

#endif //RENDERER_2D_GEOMETRY_H
