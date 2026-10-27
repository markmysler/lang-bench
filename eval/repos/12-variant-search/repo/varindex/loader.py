"""Loads the variant index into memory: about 4 GB, and about 3 minutes to load."""
import numpy as np


def load(path: str):
    positions = np.load(f"{path}/positions.npy")          # sorted, one per variant
    chromosomes = np.load(f"{path}/chromosomes.npy")
    annotations = np.load(f"{path}/annotations.npy", allow_pickle=True)
    return positions, chromosomes, annotations


def lookup(index, chromosome: str, start: int, end: int | None = None):
    positions, chromosomes, annotations = index
    end = start if end is None else end
    mask = (chromosomes == chromosome) & (positions >= start) & (positions <= end)
    return annotations[mask]
