```
STEP 1 of 9 — ORIENTATION. Do not write any code yet.

I am working on BGone: an Expo SDK 54 / React Native app that removes image
backgrounds entirely on-device, inside stock Expo Go. It has no native modules of its
own. All model inference happens inside a hidden 1x1 WebView that acts as a compute
sandbox: React Native owns the UI and the files, the WebView owns the model, and the
two talk by passing strings.

Read these files before answering anything:
- CLAUDE.md if it exists, otherwise README.md and DECISIONS.md
- src/lib/types.ts                 the bridge protocol between RN and the WebView
- src/lib/manifest.ts              the pinned list of model and runtime files
- src/lib/engine.tsx               state machine, chunked file server, watchdogs
- assets/webview/inference.html    the only file that touches a model

Over the next steps I am going to add a SECOND model to this engine: CLIP, which turns
an image into a 512-number vector describing what is in it. The existing background
removal must keep working exactly as it does now, and must never wait for the new
model.

Rules for this whole session, follow them literally:

1. Do NOT install any package. Do not run npm install <pkg>, npm i <pkg>,
   npx expo install <pkg>, npx expo install --fix, npx expo prebuild, or eas build.
   The only dependency command allowed is: npm ci
2. Do NOT create babel.config.js. This project does not have one and that is correct.
   babel-preset-expo already adds everything needed. Creating one silently breaks the
   app with error messages that point somewhere else entirely.
3. Do NOT modify app.json, package.json, package-lock.json or metro.config.js.
4. After every code change run exactly one check: npx tsc --noEmit
   Run no other verification command. Do not start the app, it is already running.
5. If you think a new package is required, do not install it. Say which one and why,
   and stop.

Now answer in a few sentences, with no code: how does the WebView page ask React Native
for the bytes of a model file, and how do those bytes reach it? Name the message types
involved.
```

```
STEP 2 of 9 — PIN THE NEW MODEL FILES.

Add the CLIP model files to the manifest module, src/lib/manifest.ts.

Use exactly these values. They are measured, not guessed, and the byte sizes double as
the integrity check:

  repo:     Xenova/mobileclip_s0
  revision: 757d59c9c6870a76a4b0306f05f5061bca15c39f
  base URL: https://huggingface.co/<repo>/resolve/<revision>/

  onnx/vision_model.onnx            45543630 bytes
  onnx/text_model_quantized.onnx    42799238 bytes
  tokenizer.json                     2224081 bytes
  tokenizer_config.json                  763 bytes

Requirements:

- Export these as a SEPARATE list, for example CLIP_FILES. They must NOT be appended to
  the existing MANAGED_FILES array. MANAGED_FILES is the set the engine refuses to
  start without, and background removal has to keep working on a phone that has never
  asked for a tag. These four are fetched on demand instead.
- Update findManagedFile so it searches the existing list first and then the new one.
  That is what gives the new files an exact size to verify against when they are pulled
  on demand.
- Also export the total expected byte count of the new list, so the UI can tell the
  user what a first tag will cost.
- Do NOT touch TOTAL_EXPECTED_BYTES or anything else about the existing model.

Two things that will look like mistakes. They are not. Keep them exactly as written:

- The image encoder is the FULL PRECISION file at 45 MB, not the 11 MB quantized one
  that also exists in that repo. The repo's own config pins dtype.vision_model to fp32.
  I tested the quantized export: it loads, runs, and returns well-formed 512-number
  vectors that rank nonsense. Cosine similarity between the two exports on the same
  image measured 0.05, and negative on one test image, where a sound quantization would
  be above 0.95. It is also the SLOWER of the two, because its int8 graph is full of
  ConvInteger nodes. Do not "optimize" this back down to the smaller file.
- The text encoder IS the quantized file. Only the image tower quantizes badly.

Only these four files ever cross the wire. CLIP's own config.json and
preprocessor_config.json are deliberately absent from the list; step 4 explains why.

Then run: npx tsc --noEmit
```

```
STEP 3 of 9 — EXTEND THE BRIDGE PROTOCOL.

In src/lib/types.ts, add the message types for embedding. Follow the style of the
existing discriminated unions exactly, doc comments included.

Add to the RN -> page union:
- an embedImage message carrying imageBase64 and mimeType
- an embedText message carrying an array of strings

Add to the page -> RN union:
- an embedding message whose payload has:
    vectors: number[][]   one L2-normalised vector per input
    dim: number           length of each vector, 512 for this model
    ms: number            forward pass only
    loadMs: number        time spent loading the encoder, 0 unless this call loaded it

Export that payload as a named interface, for example EmbeddingPayload.

Also extend the GalleryItem interface with three optional fields:
    embedding?: number[]   the L2-normalised image vector
    tags?: string[]        human-readable labels derived from it
    caption?: string       one assembled sentence

In the comments, say WHY the vectors are normalised inside the page rather than by each
consumer: it makes a dot product a cosine similarity everywhere, with no way for any
caller to forget.

Then run: npx tsc --noEmit
```

```
STEP 4 of 9 — ADD THE SECOND MODEL TO THE ENGINE PAGE.

Edit assets/webview/inference.html. Match the existing style: a plain ES5-ish IIFE, var
declarations, no imports, no build step.

Add the following alongside the existing background-removal model, without disturbing
how that one loads or runs.

A. Two lazy loaders, each guarded by its own cached promise so a second call cannot
   load twice, and each clearing the page's byte cache once the session owns its
   weights:

   Image encoder:
     T.CLIPVisionModelWithProjection.from_pretrained('Xenova/mobileclip_s0', {
       config: { model_type: 'clip' },
       device: <the same device the existing model chose>,
       dtype: 'fp32',
       progress_callback: <the existing progress callback>
     })

   Text encoder:
     T.CLIPTextModelWithProjection.from_pretrained('Xenova/mobileclip_s0', {
       config: { model_type: 'clip' },
       device: <the same device>,
       dtype: 'q8',
       progress_callback: <the existing progress callback>
     })
     plus T.AutoTokenizer.from_pretrained('Xenova/mobileclip_s0')

   Load them SEPARATELY and only on demand. Tagging an image must never pull the 42 MB
   text encoder, and a user who never tags must never download either one.

B. The image processor, constructed DIRECTLY, never through AutoProcessor:

     new T.CLIPImageProcessor({
       crop_size: { height: 256, width: 256 },
       do_center_crop: true,
       do_convert_rgb: true,
       do_normalize: false,
       do_rescale: true,
       do_resize: true,
       resample: 2,
       rescale_factor: 0.00392156862745098,
       size: { shortest_edge: 256 }
     })

   Two reasons this has to be a direct construction, both verified in the library
   source, not guessed:

   AutoProcessor.from_pretrained IGNORES an inline config option. In transformers.js
   4.2.0 it calls getModelJSON(id, 'preprocessor_config.json', ...) and that function
   never reads options.config, so the file is always fetched from disk.

   And that fetch would be answered with the WRONG FILE. React Native's file server
   matches requests by BASENAME, and the background removal model already pins a file
   called preprocessor_config.json. CLIP would be handed that one, which specifies
   1024, and inference would fail with: "Got invalid dimensions for input:
   pixel_values, index: 2 Got: 1024 Expected: 256".

   Note that do_normalize is FALSE. This model takes raw [0,1] pixels with no mean or
   standard deviation applied. Copy these constants exactly. Wrong preprocessing here
   does not throw; it quietly returns vectors that rank badly.

C. Two functions, embedImage and embedText, each taking the job id its reply must echo:
   - both respect the page's existing single-job busy flag
   - embedImage decodes the base64 into a Blob, runs it through the processor and the
     image encoder, and reads outputs.image_embeds
   - embedText tokenizes with padding to a FIXED length of 77 and truncation, runs the
     text encoder, and reads outputs.text_embeds. CLIP's text tower is trained at a
     fixed 77-token context; padding to the longest string in the batch instead would
     hand the graph the wrong input shape.
   - both turn the output tensor into an array of L2-NORMALISED plain arrays, reading
     tensor.data and tensor.dims, and report dim, forward-pass ms and encoder load ms
   - both report failure through the page's existing per-job error message, never as a
     fatal engine error

D. Handle the two new inbound message types in the page's control-channel switch, and
   dispose of both new sessions in the unload handler alongside the existing one.
```

```
STEP 5 of 9 — ADD EMBEDDING JOBS TO THE ENGINE.

Edit src/lib/engine.tsx.

Add a second kind of job, separate from the existing image-processing job:

- A dedicated job type and ref for embeddings. The reply is a few KB of JSON, so it
  needs no chunk reassembly.
- A dedicated settle function mirroring the existing one. It must be the single funnel
  where a result and a timeout race, so exactly one of them can win.
- A generous timeout, around 180 seconds, NOT the 30 second one used for cutouts. The
  first call of each kind also downloads and compiles an encoder over the same chunked
  bridge the model files use. Re-arm that timer on every progress message from the
  page, so a slow connection extends the deadline instead of tripping it.
- Handle the new embedding message: settle the job, clear progress, return to ready.
- Route a page error whose id matches an embedding job to that job. Critically, this
  must NOT move the engine to inference_failed and must NOT restart it. A failed tag is
  not an engine failure: the cutout the user is looking at is still perfectly good.
  Leave the state at ready.
- Settle any in-flight embedding job when the engine restarts and when a fatal page
  error arrives, exactly as the existing job is settled in those paths.

Expose two functions on the engine context:

    embedImage(imageBase64: string, mimeType: string): Promise<EmbeddingPayload>
    embedText(texts: string[]): Promise<EmbeddingPayload>

Both must take the SAME synchronous busy lock the existing process() takes, so a tag
and a cutout can never run at once inside a page that only has room for one session's
working memory. Both must reject immediately if the engine is not ready.

Read those guards from refs, not from React state, exactly as the existing code does.
setState is asynchronous, so two taps in one frame would both pass a check written
against state.

Then run: npx tsc --noEmit
```

```
STEP 6 of 9 — PREPARE IMAGES FOR THE EMBEDDER.

In src/lib/imagePrep.ts, add a function that turns a saved image into base64 sized for
the embedder:

    prepareForEmbedding(uri: string, width: number, height: number): Promise<string>

Behaviour:
- Resize so the SHORTEST edge is 256, matching what the processor does. If the shortest
  edge is already 256 or smaller, do not resize at all.
- Re-encode as JPEG at roughly 0.9 quality and return base64.
- Use the same expo-image-manipulator API the existing preparation function uses.

Why this matters: the model consumes a 256x256 centre crop, so anything larger is paid
for twice and then thrown away. More importantly, a full-size cutout PNG is several MB,
which becomes several MB of base64 inside a SINGLE injectJavaScript call. The engine
transfers model files in 1 MB chunks precisely to avoid payloads that size, so sending
one unchunked risks failing on the native side with nothing useful in the logs.

Then run: npx tsc --noEmit
```

```
STEP 7 of 9 — TURN VECTORS INTO WORDS.

Create a new module, src/lib/tags.ts, with no React dependency. Take engine functions
as arguments rather than importing context.

A. Three label axes. Each entry has a short display name and a caption-style prompt,
   because CLIP was trained on captions and scores a caption better than a bare noun.

   SUBJECT, around 16 broad and mutually distinguishable options: person, dog, cat,
   food, drink, car, building, plant, landscape, clothing, shoe, furniture, product,
   screenshot, document, toy. Keep them from overlapping. Two labels that mean nearly
   the same thing split the score between them and neither wins cleanly.

   SHOT: a close-up, a portrait, a full-body shot, a wide shot.

   SETTING: indoors, outdoors, at night, on a plain background.

B. A function that embeds every prompt from every axis in ONE batch and caches the
   resulting vectors in AsyncStorage, keyed so that changing the prompt list
   invalidates the cache. Keep an in-memory copy as well. Round the stored numbers to
   about five decimals to halve what is written; that difference cannot change a
   ranking.

   This cache is the point of the module. Embedding an image needs the 45 MB image
   encoder, but embedding a LABEL needs the 42 MB text one. Cached, the text encoder is
   downloaded once per device and afterwards is only ever needed for free-text search.

C. A shared scoring helper. Both sides are unit vectors, so a dot product is already a
   cosine similarity. But do NOT threshold on the raw cosine. CLIP's similarities for
   every label, related or not, sit inside a band roughly 0.15 wide, so a rule like
   "within 0.02 of the winner" is inside the noise. That is exactly what made a
   portrait come back as "person, plant, dog" when I first built this.

   CLIP was trained with a learned logit scale of about 100. Multiply the cosines by
   100, then softmax. At that scale a 0.02 gap becomes 2 logits, roughly a sevenfold
   difference in probability, which separates what the raw numbers could not.

D. tagsFor(embedding, labelVectors, options): subject labels, best first. Default to
   returning ONE label. Always keep the winner however unsure the model is, so an image
   that matches nothing still gets its closest word rather than nothing at all. Any
   runner-up has to hold a minimum share of the probability mass, default around 0.15,
   to be included.

E. captionFor(embedding, labelVectors): one assembled sentence, for example
   "a close-up of a person, indoors".

   CLIP CANNOT WRITE A CAPTION. It has no decoder; it can only score an image against
   text you hand it. So the sentence is assembled, not generated: score the same image
   vector against all three axes and include the shot and the setting ONLY when that
   axis's winner is confident, around 0.55 of the mass. An axis the model is unsure of
   stays out of the sentence rather than guessing. Always name the subject. Each extra
   axis is one more dot product against a vector that already exists, so this costs
   nothing per image.

F. describeCutout(embedder, itemId, source): the routine the UI calls. It must
   - prepare the source image at 256 and embed it
   - PERSIST THE EMBEDDING IMMEDIATELY, before attempting to name it. An image with a
     vector is already searchable, and naming it depends on the larger encoder, which
     is the part most likely to be interrupted. A run that gets only that far has still
     made progress worth keeping.
   - then compute tags and caption and persist those
   - return all three

Also add a function to the gallery module that patches embedding, tags and caption onto
an already-saved item by id, and does nothing at all if that id is gone.

Then run: npx tsc --noEmit
```

```
STEP 8 of 9 — SHOW IT IN THE APP.

A. A small presentational component that renders a caption sentence with label chips
   beneath it, plus a quiet "describing..." indicator while a tag is in flight. It must
   render NOTHING when there is no caption, no tags and nothing running: an untagged
   cutout is a normal state, not a gap that needs explaining.

B. On the create screen, once a cutout has been saved to the gallery, start a second
   pass that describes it. That pass must
   - run AFTER the result is already on screen, and never block or delay it
   - fail silently, logging to the console only. The cutout succeeded; a missing label
     is not something the user did wrong or can act on.
   - ignore its own result if the user has already moved on to another picture, using
     the same generation token the existing code uses for that
   - describe the ORIGINAL PICTURE THE USER PICKED, not the cutout

   That last point is not a detail. CLIP was trained on ordinary photographs, and a
   subject floating on the flat background that matting leaves behind is well outside
   that distribution. Embedding the cutout made a selfie come back as "a full body shot
   of a plant on a plain background". Embedding the original returns "a close-up of a
   person". The gallery row still owns the result either way.

C. In the gallery detail screen, show the stored caption and tags for an item. Add an
   action that describes an item on demand, worded "Describe this cutout" when it has
   no tags and "Describe again" when it already does, so items saved before this
   feature existed, or labelled by an earlier version of it, can be filled in or
   corrected. By then the original is long gone, so this path embeds the cutout, and
   that is expected.

Then run: npx tsc --noEmit
```

```
STEP 9 of 9 — AUDIT YOUR OWN WORK. Change nothing unless a check fails.

Go back through everything you wrote and confirm each item below. Answer with the file
and line for each, and say plainly if any one of them is wrong:

1. The image encoder resolves to vision_model.onnx at full precision, NOT
   vision_model_quantized.onnx. dtype is 'fp32' for the vision tower and 'q8' for the
   text tower.
2. The image processor is built with new directly. AutoProcessor.from_pretrained is not
   used for it anywhere.
3. do_normalize is false and rescale_factor is 0.00392156862745098.
4. The text tokenizer pads to a fixed length of 77.
5. The CLIP files are NOT in MANAGED_FILES, so background removal still starts on a
   device that has never tagged anything.
6. Vectors are L2-normalised exactly once, inside the WebView page, and no consumer
   normalises them a second time.
7. Label cosines are multiplied by 100 before the softmax.
8. The create screen embeds the ORIGINAL picked image, not the cutout PNG.
9. A failed embedding leaves the engine state at ready and does not trigger a restart.
10. Embedding and background removal share one busy lock and cannot run at the same
    time.

Then run: npx tsc --noEmit
```
