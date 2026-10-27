# Variant lookup service

Collaborators should look up variants on the web instead of asking us.

- Look up one variant (chromosome and position) or a region (chromosome, start, end).
- Answer in under 50 ms.
- Up to 100 lookups a second when a paper comes out; usually very few.
- It runs on our one virtual machine: 4 vCPUs, 16 GB.
- The index is 4 GB in memory and takes 3 minutes to load (`varindex/loader.py`).
