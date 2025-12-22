```bash
npm run scan
npm run generate -- --year=2025 --limit=10
```


### Count emails per variant
```bash
grep -h "variant_id" sent/*.json | sort | uniq -c
```