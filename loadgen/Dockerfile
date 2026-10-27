# oha, pinned by digest, with a script that applies load in one-second slices.
FROM ghcr.io/hatoo/oha:1.16.0@sha256:3ec3dbf549ea197793482d47a6324797411406bbf438c2fe8b91f244ec641a2f
COPY slices.sh /slices.sh
ENTRYPOINT ["/bin/sh", "/slices.sh"]
