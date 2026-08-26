```
I have a reference project open next to mine. It is the same app as mine, one step
ahead: it can describe an image, not just cut its background out. I want to bring my
own project to that point, in my own code and my own style.

First, get oriented. In MY project read CLAUDE.md, src/lib/types.ts and
assets/webview/inference.html, enough to understand how React Native and the hidden
WebView talk to each other and how model files reach the page.

Rules for this whole session: install nothing, create no babel.config.js, do not touch
app.json or package.json. After each change run only: npx tsc --noEmit

Do not write code yet. Tell me in three sentences what the WebView is actually for in
this app, and where the reference project's version differs from mine.
```

```
Look at how the reference project pins the CLIP model files in src/lib/manifest.ts,
and at the embedding messages it added to src/lib/types.ts.

Do the same in my project: pin the same files with the same exact byte sizes, and add
the same messages to my bridge protocol. Also add the embedding, tags and caption
fields to my gallery item type.

One thing not to tidy up: the CLIP files are kept OUT of MANAGED_FILES on purpose, in
their own list. That is what lets background removal still work on a phone that has
never tagged anything.

Then run: npx tsc --noEmit
```

```
Look at how the reference project loads CLIP inside assets/webview/inference.html —
the two lazy encoder loaders, the image processor, and the embedImage / embedText
functions. Read the comments around them, they explain the choices.

Build the same thing in my project's engine page, matching my file's existing style.

INSERT alongside what is already there. Do not rewrite or reformat this file — the
background removal in it works and I want it untouched.

Two things not to "improve": the image encoder is deliberately full precision rather
than the smaller quantized file, and the image processor is deliberately constructed
with new instead of AutoProcessor. Both look wasteful. Both are load-bearing, and the
comments say why.

Note that npx tsc does NOT check this file — it is a plain asset, so the compiler never
reads a line of it. The reference project has scripts/check-engine.mjs for exactly this:
copy that file into my project first, and when you are done run

    node scripts/check-engine.mjs

It compiles the page without running it, so a syntax error shows up with a line number
instead of as a blank screen later. Once it passes, tell me to reload the app and cut
out a background, and wait for me to confirm before we go on.
```

```
Look at how the reference project handles embedding jobs in src/lib/engine.tsx: the
separate job type, its own settle function, its longer timeout, and the two functions
it exposes on the engine context.

Add the equivalent to my engine.

One behaviour to keep exactly: a failed embedding must leave the engine in the ready
state and must not restart it. A tag failing is not the engine failing — the cutout on
screen is still fine. Embedding and background removal do share one busy lock, though,
so they can never run at the same time.

Then run: npx tsc --noEmit, and tell me to reload and cut out a background again before
we go on. Nothing visible should have changed yet — that is the point of the check.
```

```
Look at src/lib/tags.ts and the prepareForEmbedding function in src/lib/imagePrep.ts in
the reference project. Read the comments in tags.ts carefully — the label axes, the
cached label vectors, the scoring, and how the caption sentence is assembled.

Build the equivalent in my project. Feel free to change the labels to suit what I
actually photograph.

One thing not to simplify away: the similarity scores are multiplied by 100 before the
softmax. Without that every label looks equally likely and the tags come out as
nonsense.

Then run: npx tsc --noEmit
```

```
Look at how the reference project surfaces all this: the TagChips component, the second
pass that runs on the create screen after a cutout is saved, and the caption and tags
shown in the gallery detail screen.

Wire the same into my app, designed my way — I do not want a copy of their layout.

One thing to get right: the create screen describes the ORIGINAL picture the user
picked, not the cutout. The reference explains why in a comment, and the difference is
the whole feature working or not.

Then run: npx tsc --noEmit
```

```
Now check your own work against the reference. Do not change anything unless a check
actually fails — tell me first if one does.

1. Full precision image encoder, quantized text encoder.
2. The image processor is built with new, not AutoProcessor.
3. CLIP files are not in MANAGED_FILES.
4. Vectors are normalised once, in the WebView page, and never again afterwards.
5. Scores are scaled by 100 before the softmax.
6. The create screen embeds the original image, not the cutout.
7. A failed embedding leaves the engine ready.

Then run: npx tsc --noEmit
```
