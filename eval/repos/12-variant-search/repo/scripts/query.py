# How we query today: load the index (3 minutes), then look things up by hand.
import sys
from varindex.loader import load, lookup

index = load(sys.argv[1])
print(lookup(index, sys.argv[2], int(sys.argv[3])))
