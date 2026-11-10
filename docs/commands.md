# MoonCow Search Features

## Natural Language Search with Fuzzy Matching

MoonCow now supports natural language queries with typo tolerance and fuzzy matching. You can search for tools using conversational language instead of exact keywords.

### IP Address Lookup
**Patterns:** `my ip`, `what is my ip`, `ip address`, `show my ip`, `get my ip`, `find my ip`, `check my ip`, `ip lookup`, `public ip`, `external ip`, `internet ip`, `current ip`

### Base64 Encoding/Decoding
**Encode patterns:** `base64 encode`, `encode to base64`, `convert to base64`, `base64`, `to base64`, `in base64`, `as base64`, `make base64`, `turn into base64`, `b64 encode`, `b64`

**Decode patterns:** `base64 decode`, `decode base64`, `from base64`, `base64 to text`, `decode from base64`, `base64 decrypt`, `b64 decode`, `decode b64`

**Examples:**
- `base64 hello world` → Encodes "hello world"
- `convert hello world to base64` → Encodes "hello world"
- `SGVsbG8gV29ybGQ= from base64` → Decodes the string

### Settings & Configuration
**Patterns:** `settings`, `setting`, `options`, `config`, `configuration`, `preferences`, `setup`, `configure`, `change settings`, `open settings`, `extension settings`, `sett`, `opts`, `prefs`

**Dark Mode:** `dark mode`, `dark theme`, `night mode`, `black theme`, `toggle dark`, `enable dark`, `disable dark`, `switch theme`, `theme toggle`

### Coin Flip
**Patterns:** `flip a coin`, `coin flip`, `flip coin`, `coin toss`, `toss a coin`, `toss coin`, `heads or tails`, `heads tails`, `random coin`, `coin`, `flip`, `toss`, `heads tail`, `ht`, `h or t`

### Dice Rolling
**Patterns:** `roll dice`, `roll die`, `roll a die`, `dice roll`, `die roll`, `random dice`, `dice`, `die`, `roll`, `d6`, `six sided die`, `throw dice`

**Specific dice:** `d20`, `roll d6`, `20 sided die`, `roll 20 sided die`

### Password Generation
**Patterns:** `password`, `generate password`, `create password`, `make password`, `new password`, `random password`, `strong password`, `secure password`, `safe password`, `password generator`, `pass`, `pwd`, `passgen`, `gen password`, `password gen`

**With length:** `password 12`, `12 character password`, `generate 16 password`

### QR Code Generation
**Patterns:** `qr code`, `qr`, `generate qr`, `create qr`, `make qr`, `qr generator`, `qr gen`, `to qr`, `as qr`, `qr for`, `quick response`, `barcode`

**Examples:**
- `qr code hello world` → Generates QR for "hello world"
- `hello world qr code` → Generates QR for "hello world"

### User Agent Detection
**Patterns:** `user agent`, `my user agent`, `useragent`, `my useragent`, `browser string`, `browser info`, `browser agent`, `ua string`, `what browser`, `browser version`, `my browser`, `browser details`, `user string`, `client string`

### URL Shortening
**Patterns:** `shorten`, `short`, `shorten url`, `short url`, `make short`, `url short`, `tiny url`, `tinyurl`, `short link`, `shorten link`, `compress url`, `minify url`

**Examples:**
- `shorten https://example.com` → Shortens the URL
- `https://example.com short url` → Shortens the URL

### Lorem Ipsum Generator
**Patterns:** `lorem ipsum`, `lorem`, `ipsum`, `placeholder text`, `dummy text`, `filler text`, `sample text`, `fake text`, `lorem generator`, `latin text`, `lipsum`, `placeholder`, `dummy content`, `filler content`, `text placeholder`

### Hash Generation
**Patterns:** `md5`, `sha1`, `sha256`, `hash`, `checksum`, `md5 hash`, `sha hash`, `generate hash`, `create hash`, `make hash`, `hash generator`, `encrypt`, `digest`

**Examples:**
- `md5 hello world` → Generates MD5 hash
- `hello world hash` → Generates MD5 hash (default)

### Time & Clock
**Patterns:** `what time is it`, `time in`, `what time`, `current time`, `time now`, `whats the time`, `what's the time`, `time zone`, `timezone`, `clock`, `time`

**Timezone queries:** `time in pst`, `what time is it in est`, `current time in utc`

## Fuzzy Matching Features

- **Typo tolerance:** Search works even with spelling mistakes (85% similarity threshold)
- **Word-based matching:** Multi-word patterns match even if words are in different order
- **Substring matching:** Partial matches are supported
- **Natural language:** Conversational queries work alongside exact patterns

## Calculator & Math
Math detection remains the same - supports expressions like `2+2`, `sqrt(16)`, `sin(45)`, etc.

## Unit Conversion
Unit conversion supports patterns like `10 kg to lb`, `32 fahrenheit to celsius`, etc. 