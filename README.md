# butterflyfx.us

The personal portfolio site of Kenneth W. Bingham: AI Engineer, Backend and Platform
Engineer. A static, dependency-light site that leads with proof (working software with
real, reproducible numbers) and presents the dimensional-programming research with every
claim labeled by how well it is supported.

This is its own repository, separate from kensgames.com, because butterflyfx.us has its own
domain, docroot, and deploy.

## Structure

```
public/                 the served site (docroot contents)
  index.html            landing: who, proof, approach + vision, skills, hiring
  about.html            concise bio
  method.html           how I structure AI: truth tables, gates, decision trees, geometry
  research.html         measured demos + claim-labeled essays
  resume.html           public resume (no contact details; see contact page)
  contact.html          the one place with contact details
  bfx-ingest.html       project detail: deterministic LLM context tool
  manifold-lens.html    interactive z = x*y lens demo
  dimensional-benchmark.html  eager (OOP) vs lazy (dimensional) LLM-context cost demo
  manifold-ai/          interactive agent demo (auth-gated)
  manifold-ide/         web IDE demo (auth-gated; has its own local-server.js)
  assets/, *.css, *.js, images
deploy.sh               sync public/ to the live docroot and reload nginx
```

## Conventions

- One unified nav across the public pages: Home, About, Method, Resume, Research, Contact, GitHub.
- House style: no em-dashes; no city or email on public pages (contact lives on contact.html).
- Honesty rule: lead with measured proof; label research claims established / defensible
  model / conjecture under test; never claim a result that is not demonstrated and tested.

## Deploy

On the VPS (butterfly user, no root needed):

```bash
bash deploy.sh   # rsync public/ -> /var/www/butterflyfx.us/public, reload nginx
```

Note: `deploy.sh` does not use `rsync --delete`, so a removed page must also be deleted
from the live docroot (`/var/www/butterflyfx.us/public`) directly.
