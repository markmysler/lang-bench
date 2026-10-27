# Published runs

Runs in this folder are shown by the read-only results viewer on GitHub Pages. To publish a run,
copy its file from `results/` (which git ignores) and commit it:

```sh
cp results/<run id>.json published/
```

Publish runs made from a clean checkout, so that their commit identifies the exact code that was
measured.
