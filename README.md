# Record shop / music player template — audio-reactive vinyl

**Live demo → https://bswxyz.github.io/formwork-revolver/** · [How it was built](https://bswxyz.github.io/formwork-revolver/guide/)

> A spinning vinyl with tonearm, circular visualizer ring and a generative Web-Audio groove (click to play).

A free, MIT-licensed website template. Good for: **record shops, DJs, radio shows, music blogs**.
The demo brand ("REVOLVER") is fictional — every word and colour is meant to be replaced with yours.

## The signature technique

- Vinyl + grooves + label rendered in CSS/SVG; tonearm swings on play
- Web Audio loop through an AnalyserNode drives a circular waveform around the record
- Crate tracklist — selecting a row 'loads' it onto the deck

## Use this as your own site

This repo is a **template** — everything is plain HTML/CSS/JS with **relative paths**, so it
works under *any* repo name with zero configuration.

1. Click **Use this template → Create a new repository** (top of this page).
   **Name it whatever you like** — `my-site`, `portfolio`, anything.
2. In your new repo: **Settings → Pages → Build and deployment → Deploy from a branch**,
   then pick `main` / `/ (root)` and save. (CLI: see below.)
3. Wait ~1 minute. Your site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`.

<details>
<summary>Prefer the command line?</summary>

```bash
gh repo create my-site --template bswxyz/formwork-revolver --public --clone
cd my-site
gh api --method POST /repos/YOUR-USERNAME/my-site/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```
</details>

No build step, no dependencies to install — edit the files, push, done.
The only external requests are Google Fonts and (where used) pinned CDN copies of GSAP/three.js.

## Customize it

- Tracks: the crate list in `index.html` (title/artist/time/genre)
- Groove: the generative loop's notes/tempo in `main.js`
- Accent: molten orange `#ff5a1f` in `:root`

The `/guide/` page documents the signature technique in depth (with code) — keep it, rewrite it,
or delete the folder entirely.

## Files

```
index.html        the page
styles.css        all styling (design tokens in :root at the top)
main.js           the signature effect + motion
guide/index.html  how-it-works write-up (optional — yours to keep or delete)
```

## Built-in quality

- Works with JS disabled or a CDN failure (content is never permanently hidden)
- Respects `prefers-reduced-motion`; keyboard focus styles throughout
- Canvas/WebGL feature-detected with graceful fallbacks; devicePixelRatio capped for performance
- Responsive at phone / tablet / desktop widths

## License & credit

[MIT](LICENSE) — free for personal and commercial use, no attribution required
(a link back is always appreciated). Part of **FORMWORK** — a collection of
25 free website templates: **[the full gallery →](https://bswxyz.github.io/formwork/)**
