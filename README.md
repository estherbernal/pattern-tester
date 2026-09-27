# Pattern Tester

A small browser tool for previewing how a motif looks as a repeating surface pattern.

Drop in an image and see it repeated across the screen. Change its scale and switch between four repeat types:

- **Block**: a straight grid.
- **Half-drop**: each column shifts down by 1/2, 1/3 or 1/4 of the motif height.
- **Brick**: each row shifts sideways by 1/2, 1/3 or 1/4 of the motif width.
- **Tossed**: motifs scattered at random, with control over how many there are, their spacing, size variation and rotation. The layout still tiles seamlessly.

You can also set a background colour, show or hide the outline of one repeat unit, and download either the full-resolution repeat tile or the current preview as a PNG.

## Run it

It's plain HTML, CSS and JavaScript with no build step or dependencies.

- **Locally:** open `index.html` in a browser.
- **Online:** publish the repo with GitHub Pages (Settings → Pages → deploy from the `main` branch, root folder).

## Loading an image

Drag an image anywhere onto the page, click the motif box to pick a file, or paste one from the clipboard. PNG, JPG, WebP and SVG all work, and transparent images show the background colour through them.

## Privacy

Images are never uploaded. The file is read and drawn on a canvas entirely inside your browser, and downloads are generated there too. Nothing is sent to a server, and the image is gone when you reload the page.

The only outside request is for the fonts, from Google Fonts. Without a connection the page falls back to system fonts.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and controls |
| `styles.css` | Layout and light/dark theme |
| `app.js` | Image loading, repeat building, rendering and export |
