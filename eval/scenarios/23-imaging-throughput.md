# 23-imaging-throughput

**Team:** rails-imaging

## Situation

Processing one image takes 150 to 400 ms of CPU, mostly in libvips and the tagging model. A
pilot customer uploaded 50,000 photos and it took six hours; customers expect under one. Today
Rails handles the upload API and Sidekiq jobs do the processing in Ruby, calling libvips.

## The request

> We need to process big catalogues much faster. Is Ruby the problem? Should we rebuild the processing in another language while we're still small?
