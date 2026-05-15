# Nano Banana Pro & NB2 — Riferimento Tecnico API

**Aggiornato**: 14 Maggio 2026
**Fonti ufficiali verificate**: changelog API (7 May 2026), pricing page (8 May 2026), thinking docs (7 May 2026), model card Pro (26 Feb 2026), image generation page.

Sezioni marcate `⚠️ NON UFFICIALE` sono empiriche da provider terzi/community.

---

## 1. Modelli attivi

| Nome commerciale | Model ID API | Stato |
|---|---|---|
| Nano Banana Pro | `gemini-3-pro-image-preview` | Preview, attivo (rilasciato 20 Nov 2025) |
| Nano Banana 2 | `gemini-3.1-flash-image-preview` | Preview, attivo (rilasciato 26 Feb 2026) |

**Legacy chiuso** (NON usare): `gemini-2.5-flash-image-preview` → shut down 15 Gennaio 2026.

⚠️ Entrambi i modelli sono in stato **Preview**, soggetti a possibili breaking change con preavviso minimo di 2 settimane. Per produzione critica monitora `ai.google.dev/gemini-api/docs/deprecations`.

---

## 2. Specifiche per modello

### Pro — `gemini-3-pro-image-preview`

| Property | Valore |
|---|---|
| Input | Image + Text |
| Output | Image + Text |
| Input token limit | 65.536 |
| Output token limit | 32.768 |
| Knowledge cutoff | Gennaio 2025 |
| Risoluzioni output | 1K, 2K, 4K |
| Aspect ratios | 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 |
| Reference images | Fino a 14 totali (5 character hi-fi + 6 object hi-fi documentati) |
| Thinking | **Sempre ON, non disattivabile** |
| Grounding | Web Search supportato, Maps non supportato |
| Function calling | Non supportato |
| Caching | Non supportato |
| Batch API | Supportato |

### NB2 — `gemini-3.1-flash-image-preview`

| Property | Valore |
|---|---|
| Input | Image + Text |
| Output | Image + Text |
| Input token limit | 131.072 |
| Output token limit | 32.768 |
| Knowledge cutoff | Gennaio 2025 |
| Risoluzioni output | 512 (0.5K), 1K, 2K, 4K |
| Aspect ratios | Tutte di Pro + `1:4`, `4:1`, `1:8`, `8:1` |
| Reference images | Fino a 14 totali (4 character + 10 object hi-fi documentati) |
| Thinking | Configurabile (`minimal` default, `high`) |
| Grounding | Web Search + **Image Search** (esclusivo) |
| Function calling | Non supportato |
| Caching | Non supportato |
| Batch API | Supportato |

---

## 3. Output dell'API

### Formato risposta

```python
for part in response.parts:
    if part.inline_data is not None:
        # part.inline_data.mime_type contiene il MIME type effettivo
        image = part.as_image()  # PIL Image object
        image.save("output.png")
```

### Caratteristiche output verificate (Google ufficiale)

- Output **base64-encoded** inline nella response (~33% overhead in transit vs binary)
- **No background trasparente**: "The model does not support generating a transparent background"
- Watermark **SynthID** sempre embedded
- **C2PA Content Credentials** sempre embedded

### Caratteristiche output NON documentate da Google

- ⚠️ MIME type di default: empiricamente PNG. Verifica via `part.inline_data.mime_type`
- ⚠️ Bit depth: presumibilmente 8-bit/canale (baseline PNG). Nessuna evidenza HDR/10-bit/16-bit
- ⚠️ Profilo colore: presumibilmente sRGB. Nessuna documentazione su Display-P3 / Rec.2020 / wider gamut
- ⚠️ EXIF/metadata: non documentati

**Implicazione produzione**: output 8-bit sRGB. Grading aggressivo downstream → banding. Per cinema/VFX upscale e color management gestiti esternamente.

---

## 4. Risoluzioni e aspect ratio — tabella esatta

### Parametro `image_size`

Valori accettati: `"512"`, `"1K"`, `"2K"`, `"4K"`. **K maiuscola obbligatoria**, lowercase = 400.

### NB2 — Gemini 3.1 Flash Image Preview

| Ratio | 512 | 1K | 2K | 4K |
|---|---|---|---|---|
| 1:1 | 512×512 | 1024×1024 | 2048×2048 | 4096×4096 |
| 2:3 | 424×632 | 848×1264 | 1696×2528 | 3392×5056 |
| 3:2 | 632×424 | 1264×848 | 2528×1696 | 5056×3392 |
| 3:4 | 448×600 | 896×1200 | 1792×2400 | 3584×4800 |
| 4:3 | 600×448 | 1200×896 | 2400×1792 | 4800×3584 |
| 4:5 | 464×576 | 928×1152 | 1856×2304 | 3712×4608 |
| 5:4 | 576×464 | 1152×928 | 2304×1856 | 4608×3712 |
| 9:16 | 384×688 | 768×1376 | 1536×2752 | 3072×5504 |
| 16:9 | 688×384 | 1376×768 | 2752×1536 | 5504×3072 |
| 21:9 | — | 1584×672 | 3168×1344 | 6336×2688 |
| 1:4 | 256×1024 | 512×2048 | 1024×4096 | 2048×8192 |
| 4:1 | 1024×256 | 2048×512 | 4096×1024 | 8192×2048 |
| 1:8 | 192×1536 | 384×3072 | 768×6144 | 1536×12288 |
| 8:1 | 1536×192 | 3072×384 | 6144×768 | 12288×1536 |

### Pro — Gemini 3 Pro Image Preview

Stesse dimensioni di NB2 per i ratio comuni. **Non disponibili**: `512`, `1:4`, `4:1`, `1:8`, `8:1`.

### Comportamento di default

- Text-to-image **senza** `aspect_ratio`: torna 1:1 (1024×1024 a 1K)
- Image-to-image **senza** `aspect_ratio`: matcha l'aspect ratio dell'input

In produzione: specifica sempre `aspect_ratio` esplicito.

---

## 5. Pricing ufficiale (verificato 8 Maggio 2026)

Google ora propone **4 inference tier**: Standard, Batch, Flex, Priority.

### Pro — `gemini-3-pro-image-preview`

**Input**: $2.00 / 1M token (text/image) — equivalente a $0.0011/immagine (560 token per immagine input)

**Output**:
- $12.00 / 1M token (text + thinking)
- $120.00 / 1M token (immagini)
- **1K e 2K stesso prezzo**: 1120 token → **$0.134/immagine**
- 4K: 2000 token → **$0.24/immagine**

| Tier | 1K/2K | 4K | Note |
|---|---|---|---|
| **Standard** | $0.134 | $0.24 | Default |
| **Batch** | $0.067 | $0.12 | -50%, turnaround fino a 24h |
| **Flex** | $0.067 | $0.12 | Stessa tariffa Batch, on-demand |
| **Priority** | $0.241 | $0.43 | Output @ $216/M token, ~1.8× standard |

**Implicazione critica**: 1K e 2K costano UGUALE. Genera sempre minimo 2K sul Pro.

### NB2 — `gemini-3.1-flash-image-preview`

**Input**: $0.50 / 1M token (text/image)

**Output**:
- $3.00 / 1M token (text + thinking)
- $60.00 / 1M token (immagini)

| Tier | 0.5K | 1K | 2K | 4K |
|---|---|---|---|---|
| **Standard** | $0.045 | $0.067 | $0.101 | $0.151 |
| **Batch** | $0.022 | $0.034 | $0.050 | $0.076 |

NB2 ha pricing scalare lineare per risoluzione. Non c'è il "free upgrade" 1K→2K del Pro.

### Confronto Pro vs NB2 — stessa risoluzione

| Risoluzione | Pro Standard | NB2 Standard | Pro/NB2 ratio |
|---|---|---|---|
| 1K | $0.134 | $0.067 | 2.0× |
| 2K | $0.134 | $0.101 | 1.3× |
| 4K | $0.24 | $0.151 | 1.6× |

A 2K il delta Pro vs NB2 è solo +33%. È il **sweet spot economico** se serve qualità Pro.

---

## 6. Thinking — meccanica e parametri

### Comportamento per modello

| Modello | Thinking control | Default |
|---|---|---|
| **Pro** | Sempre ON, **non disattivabile** | Massimo |
| **NB2** | Configurabile via `thinking_level` | `minimal` |

### Valori `thinking_level` per i modelli image

**Solo `minimal` e `high`** sono documentati come supportati per i modelli image (la doc image generation lo specifica esplicitamente). I valori intermedi `low` e `medium` esistono per i modelli text Gemini 3 ma **non per i modelli image**.

```python
from google import genai
from google.genai import types

# NB2 con max quality
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(
            aspect_ratio="3:2",
            image_size="2K"
        ),
        thinking_config=types.ThinkingConfig(
            thinking_level="high",        # "minimal" (default) o "high"
            include_thoughts=False         # True per ricevere bozze interne
        )
    )
)
```

⚠️ La doc immagine usa esempi con `"High"` e `"Minimal"` (maiuscolo), la doc thinking principale usa lowercase. SDK Python probabilmente accetta entrambi ma **usa lowercase** per allinearti alla doc più recente.

### Cosa fa il thinking — meccanica dichiarata

Dalla doc Google: "The model generates up to two interim images to test composition and logic. The last image within Thinking is also the final rendered image."

Quindi:
- Il modello genera fino a 2 **thought images** internamente
- Le valuta contro il prompt
- L'ultima è anche quella renderizzata come final
- Le bozze NON vengono fatturate come output separati
- I **thinking token testuali** SONO fatturati (inclusi nel output rate)

### `include_thoughts=True` per debug

Restituisce nella response anche bozze e reasoning testuale (`part.thought == True`).

```python
for part in response.parts:
    if part.thought:
        if part.text:
            print(f"REASONING: {part.text}")
        elif part.inline_data:
            # Salva bozza per ispezione
            part.as_image().save(f"thought.png")
    else:
        # Output finale
        part.as_image().save("final.png")
```

### Costi thinking

I thinking token sono **sempre fatturati** (inclusi nel output rate $12/M Pro, $3/M NB2), indipendentemente da `include_thoughts`. Settare `False` non risparmia, riduce solo bandwidth della response.

Conta i thinking token consumati via `response.usage_metadata.thoughts_token_count`.

### Minimal vs High su NB2 — cosa cambia

Dalla doc Google: "minimal thinking does not mean the model uses no thinking at all".

Quindi anche `minimal` esegue reasoning, solo ridotto. Latenza vs qualità è il trade-off principale. Google non quantifica la differenza in token o tempo.

---

## 7. Grounding — Web Search e Image Search

Il modello può collegarsi a Google Search durante la generazione. Due tipi.

### 7.1 Web Search grounding — entrambi i modelli

```python
config=types.GenerateContentConfig(
    response_modalities=['IMAGE'],
    tools=[{"google_search": {}}],
    image_config=types.ImageConfig(aspect_ratio="16:9", image_size="2K")
)
```

**Limite critico**: quando Web Search è usato con image generation, **i risultati image-based della search NON vengono passati al generation model** e sono esclusi dalla response. Solo il testo dei risultati arriva al modello. Per visual references serve Image Search (NB2 only).

### 7.2 Image Search grounding — SOLO NB2

Esclusiva di `gemini-3.1-flash-image-preview`. Recupera immagini reali da Google come visual reference prima di generare.

```python
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        tools=[
            types.Tool(google_search=types.GoogleSearch(
                search_types=types.SearchTypes(
                    web_search=types.WebSearch(),
                    image_search=types.ImageSearch()
                )
            ))
        ]
    )
)
```

`searchTypes` può abilitare `webSearch`, `imageSearch`, o entrambi.

### Limiti Image Search documentati

- **Non funziona su persone reali da web** (privacy)
- Disponibile solo via API native format. Alcuni gateway OpenAI-compatible **non la supportano**
- I tokens delle immagini retrieved NON sono fatturati come input (esplicitamente confermato nella pricing page)

### Pricing Grounding

**Tutti i modelli Gemini 3** condividono lo stesso pool:
- **5.000 prompt/mese gratuiti**, shared across Gemini 3 family
- Oltre il free tier: **$14 / 1.000 search queries**
- Una request può triggerare più search queries (vengono fatturate individualmente)

Web Search billing è attivo dal **5 Gennaio 2026** (prima era gratis).

### Response metadata Grounding

```python
metadata = response.candidates[0].grounding_metadata

# Per web search
metadata.search_entry_point.rendered_content  # HTML/CSS per "Search Suggestions"
metadata.grounding_chunks                       # top 3 source web

# Per image search (NB2 only)
metadata.image_search_queries                   # query usate dal modello
metadata.grounding_chunks                       # con uri (landing page) + image_uri (img diretta)
metadata.grounding_supports                     # mapping content → source
```

### Display requirements obbligatori (Image Search)

Se mostri grounded image search nei tuoi prodotti **DEVI**:

1. **Source attribution**: link cliccabile alla landing page contenente l'immagine sorgente (NON il file immagine)
2. **Direct navigation**: dalla source image alla landing page in **un solo click**. No image viewer intermedio, no path multi-click

Violare = TOS violation, può portare a revoca accesso API.

---

## 8. Input — File handling

### MIME types accettati

`image/png`, `image/jpeg`, `image/webp`, `image/heic`, `image/heif`. PDF supportato come document input.

### Due strade per inviare immagini

**Inline base64**:
- Da Gennaio 2026: limite per file aumentato a 100MB (era 20MB)
- Latenza maggiore su payload grandi

**Files API** (raccomandato per produzione):
- Max 100MB per file
- File persistito 48h, poi auto-cancellato
- Riutilizzabile su molte chiamate senza re-upload
- Payload request più pulito

```python
uploaded_file = client.files.upload(file="reference.jpg")
response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=[prompt, uploaded_file]
)
```

### Cloud Storage e pre-signed URL

Dal Gennaio 2026 puoi usare:
- Google Cloud Storage bucket URI come input source
- Qualsiasi public o private DB pre-signed URL

Utile per pipeline AYCB-style: i ref sono in GCS, passi URI invece di base64.

### Reference images — limiti documentati Google

**Pro** (`gemini-3-pro-image-preview`):
- Fino a 6 object hi-fidelity inclusion
- Fino a 5 character images per consistency
- Totale max 14 ref

**NB2** (`gemini-3.1-flash-image-preview`):
- Fino a 10 object hi-fidelity
- Fino a 4 character images
- Totale max 14 ref

⚠️ NON UFFICIALE: oltre i 6 reference complessivi degrada fidelity. Test empirico community, non confermato Google.

### Input image cost (Pro)

Confermato dalla pricing page: **560 token per immagine input**, equivalente a **$0.0011/immagine** input sul tier Standard. Sul tier Batch dimezzato a $0.0006.

---

## 9. Multi-turn editing e Thought Signatures

### Chat memory

```python
chat = client.chats.create(
    model="gemini-3-pro-image-preview",
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(aspect_ratio="3:2", image_size="2K")
    )
)

response1 = chat.send_message([prompt, initial_image])
response2 = chat.send_message("Keep everything identical, change only X")
```

Il modello mantiene session context. Ogni edit **rigenera l'intera immagine**, non c'è binary patching.

### Thought Signatures — Gemini 3 strict mode

Su Gemini 3 i thought signatures possono essere restituiti **per tutti i tipi di part**, non solo image. Google raccomanda di passarli sempre indietro come ricevuti. Richiesto obbligatoriamente per function calling.

**Se usi `client.chats.create()`** dell'SDK ufficiale: gestito automaticamente. Ignora.

**Se costruisci conversation history manualmente** (orchestrator custom, REST diretto):
- Inline_data con `mime_type=image/*` nelle response hanno signature
- Il primo text part dopo image parts ha signature
- Le bozze marcate `thought=True` NON hanno signature
- Devi rispedire tutte le signature nei turn successivi

Failure a rispedirle: nei modelli Gemini 3 la validazione è "stricter" → errore o degradazione qualità.

Verifica nella response: `part.thought_signature` (campo opzionale).

---

## 10. Rate limits e error handling

### Rate limits

Documentazione dinamica: `ai.google.dev/gemini-api/docs/rate-limits` per tier corrente.

- **Free tier**: image generation **non disponibile** né per Pro né per NB2. Billing obbligatorio.
- **Paid tier 1-3**: scalano con storia di spending. Verifica console Google Cloud → IAM → Quotas.

Dal 16 Marzo 2026 ci sono nuovi **Usage Tier** e **Billing Account spend caps** per controllo costi. Dal 12 Marzo 2026 anche **project-level spend caps**.

### Codici errore principali

| Code | Causa | Retry |
|---|---|---|
| 400 INVALID_ARGUMENT | Parametro malformato (es. `2k` lowercase, aspect ratio non supportato, model ID errato) | No, fix request |
| 400 FAILED_PRECONDITION | Feature non disponibile in regione o no billing attivo | No, fix config |
| 403 | Auth failure, API key invalida | No, fix auth |
| 404 | Model ID inesistente | No, fix model ID |
| 429 RESOURCE_EXHAUSTED | Quota tier esaurita | Sì, wait 60s+ |
| 500 | Errore transiente request-specific | Sì, retry immediato |
| 503 UNAVAILABLE | Server overload | Sì, exponential backoff |
| 504 | Timeout server-side | Sì, retry |
| SAFETY / IMAGE_SAFETY | Content filter triggered | No, modifica prompt |

### Retry pattern raccomandato

```python
import time, random

def generate_with_retry(client, **kwargs):
    delay = 5
    max_delay = 60
    max_retries = 5
    
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as e:
            code = getattr(e, 'code', None)
            if code == 429:
                time.sleep(60)
                continue
            if code in (500, 503, 504) and attempt < max_retries - 1:
                jitter = random.uniform(0.8, 1.2)
                time.sleep(min(delay * jitter, max_delay))
                delay *= 2
                continue
            raise  # 400/403/404/SAFETY: re-raise
    raise Exception("Max retries exceeded")
```

### HTTP timeout

**Imposta timeout client ≥ 180 secondi**. Default 30s di molte librerie HTTP causa silent fail su Pro 4K complessi.

⚠️ NON UFFICIALE — latenze tipiche (da provider terzi):
- NB2 minimal 1K: 3-5s
- NB2 high 2K: 15-25s
- Pro 2K: 10-30s
- Pro 4K complesso: 60-170s

### Webhooks (Maggio 2026)

Dal 4 Maggio 2026 Gemini API supporta **event-driven Webhooks** per sostituire polling. Particolarmente utile per Batch API e long-running operations. Riferimento: `ai.google.dev/gemini-api/docs/webhooks`.

---

## 11. Setup di riferimento — config "max quality"

### Pro per output finali

```python
from google import genai
from google.genai import types

client = genai.Client()

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents=[prompt, *reference_images],
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(
            aspect_ratio="3:2",      # o quello richiesto
            image_size="2K"          # 4K solo per hero/print, 1K mai (stesso prezzo del 2K)
        )
        # NO thinking_config su Pro: sempre ON
    )
)
```

### NB2 per iterazione di qualità

```python
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=[prompt, *reference_images],
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(
            aspect_ratio="3:2",
            image_size="2K"
        ),
        thinking_config=types.ThinkingConfig(
            thinking_level="high",
            include_thoughts=False
        )
    )
)
```

### NB2 con Image Search grounding

```python
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=prompt,
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        image_config=types.ImageConfig(aspect_ratio="3:2", image_size="2K"),
        thinking_config=types.ThinkingConfig(thinking_level="high"),
        tools=[
            types.Tool(google_search=types.GoogleSearch(
                search_types=types.SearchTypes(
                    web_search=types.WebSearch(),
                    image_search=types.ImageSearch()
                )
            ))
        ]
    )
)
```

### Chat multi-turn per editing iterativo

```python
chat = client.chats.create(
    model="gemini-3-pro-image-preview",
    config=types.GenerateContentConfig(
        response_modalities=['IMAGE'],
        image_config=types.ImageConfig(aspect_ratio="3:2", image_size="2K")
    )
)

r1 = chat.send_message([prompt, initial_image])
r2 = chat.send_message("Keep everything identical, change only X")
# Thought signatures gestite automaticamente dal chat SDK
```

### Batch API per volumi

```python
batch_job = client.batches.create(
    model="gemini-3-pro-image-preview",
    requests=[...]  # lista di GenerateContentRequest
)
# -50% sul prezzo standard, turnaround fino a 24h
```

---

## 12. Limiti generation documentati

- Best performance lingue: EN, ar-EG, de-DE, es-MX, fr-FR, hi-IN, id-ID, **it-IT**, ja-JP, ko-KR, pt-BR, ru-RU, ua-UA, vi-VN, zh-CN
- No audio o video input
- Numero di output images non sempre rispettato se richiesto multiplo
- Tutti gli output: SynthID + C2PA Content Credentials
- NB2 Image Search non supporta persone reali da web

---

## 13. Lacune da verificare empiricamente

Le seguenti voci non sono documentate da Google e vanno verificate nel tuo setup:

1. **MIME type effettivo output**: `response.parts[0].inline_data.mime_type`
2. **Bit depth e profilo colore output**: aprire file generato in image inspector (ImageMagick `identify -verbose`, ExifTool)
3. **Rate limit attuali del tuo tier**: console Google Cloud → IAM → Quotas
4. **Latenza P50/P95** per i tuoi prompt tipici, segmentata per modello e risoluzione
5. **Soglia reale degradazione fidelity** all'aumentare del numero ref images (test A/B)
6. **Behavior thought signatures** se usi orchestrator custom non basato su chat SDK
7. **Token consumption thinking** per i tuoi prompt tipici via `usage_metadata.thoughts_token_count`

---

## 14. Riferimenti ufficiali

- Image generation: `ai.google.dev/gemini-api/docs/image-generation`
- Model card Pro: `ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview`
- Model card NB2: `ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image-preview`
- Thinking: `ai.google.dev/gemini-api/docs/thinking`
- Thought signatures: `ai.google.dev/gemini-api/docs/thought-signatures`
- Google Search grounding: `ai.google.dev/gemini-api/docs/google-search`
- Pricing: `ai.google.dev/gemini-api/docs/pricing`
- Changelog: `ai.google.dev/gemini-api/docs/changelog`
- Deprecations: `ai.google.dev/gemini-api/docs/deprecations`
- Rate limits: `ai.google.dev/gemini-api/docs/rate-limits`
- Batch API: `ai.google.dev/gemini-api/docs/batch-api`
- Webhooks: `ai.google.dev/gemini-api/docs/webhooks`
- File Search: `ai.google.dev/gemini-api/docs/file-search`
- Vertex AI Pro: `docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-pro-image`
