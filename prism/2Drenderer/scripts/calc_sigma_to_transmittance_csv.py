import argparse
import csv
import math
import os
import tempfile
from pathlib import Path

THICKNESS_CM = 2.5
MIN_WAVELENGTH_NM = 300.0
MAX_WAVELENGTH_NM = 900.0
SIGMA_COLUMN = "sigma_cm"


def absorption_coefficient_cm(transmittance: float) -> float:
    if not 0.0 < transmittance <= 1.0:
        raise ValueError(
            f"Transmittance must be in the interval (0, 1], got {transmittance}"
        )

    return -math.log(transmittance) / THICKNESS_CM


def modify_csv(csv_path: Path) -> None:
    if not csv_path.is_file():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    with csv_path.open("r", newline="", encoding="utf-8-sig") as source:
        reader = csv.reader(source)
        rows = list(reader)

    if not rows:
        raise ValueError("The CSV file is empty")

    header = rows[0]

    if len(header) < 2:
        raise ValueError(
            "The CSV must contain at least two columns: wavelength and transmittance"
        )

    output_header = header.copy()

    if SIGMA_COLUMN in output_header:
        sigma_index = output_header.index(SIGMA_COLUMN)
    else:
        sigma_index = len(output_header)
        output_header.append(SIGMA_COLUMN)

    output_rows = [output_header]

    for line_number, row in enumerate(rows[1:], start=2):
        if not row or all(not value.strip() for value in row):
            continue

        if len(row) < 2:
            raise ValueError(
                f"Line {line_number} contains fewer than two columns"
            )

        try:
            wavelength_nm = float(row[0].strip())
            transmittance = float(row[1].strip())
        except ValueError as error:
            raise ValueError(
                f"Invalid number in line {line_number}: {row}"
            ) from error

        if not MIN_WAVELENGTH_NM <= wavelength_nm <= MAX_WAVELENGTH_NM:
            continue

        sigma_cm = absorption_coefficient_cm(transmittance)

        output_row = row.copy()

        while len(output_row) <= sigma_index:
            output_row.append("")

        output_row[sigma_index] = format(sigma_cm, ".12g")
        output_rows.append(output_row)

    temporary_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            newline="",
            encoding="utf-8",
            dir=csv_path.parent,
            prefix=f".{csv_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as destination:
            temporary_path = Path(destination.name)
            writer = csv.writer(destination)
            writer.writerows(output_rows)

        os.replace(temporary_path, csv_path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()

    print(f"Modified: {csv_path.resolve()}")
    print(f"Rows retained: {len(output_rows) - 1}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Filters wavelength/transmittance pairs to 300-900 nm and "
            "adds sigma_a_cm^-1 for a 25 mm sample."
        )
    )
    parser.add_argument(
        "csv_file",
        type=Path,
        help="CSV file to modify in place",
    )

    args = parser.parse_args()
    modify_csv(args.csv_file)


if __name__ == "__main__":
    main()
