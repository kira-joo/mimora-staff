# product-import — the batch folder

Put one batch here, then run the importer (see `../README.md`):

```
catalog.json            the products, variants and product groups
<image files>           every file catalog.json names in "sourceImageFilename"
```

The importer also writes here: `.catalog-import-state.json` (what it created — keep it until the batch is done),
`.catalog-import.lock` (only while `--execute` runs) and `import-reports/`. None of it is committed (see `.gitignore`).
