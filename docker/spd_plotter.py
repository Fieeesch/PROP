#!/usr/bin/env python3
import csv
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: spd_plotter <input.csv> <output.png>")

    wavelengths: list[float] = []
    intensities: list[float] = []
    with open(sys.argv[1], newline="", encoding="utf-8-sig") as source:
        for row in csv.reader(source):
            if len(row) < 2:
                continue
            try:
                wavelengths.append(float(row[0]))
                intensities.append(float(row[1]))
            except ValueError:
                continue

    if not wavelengths:
        raise SystemExit("SPD file contains no numeric samples")

    figure, axis = plt.subplots(figsize=(7, 4), dpi=120)
    axis.plot(wavelengths, intensities, color="#6c63ff", linewidth=2)
    axis.set_xlabel("Wavelength (nm)")
    axis.set_ylabel("Relative intensity")
    axis.grid(alpha=0.25)
    figure.tight_layout()
    figure.savefig(sys.argv[2], format="png")


if __name__ == "__main__":
    main()
