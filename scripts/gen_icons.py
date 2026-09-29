#!/usr/bin/env python3
"""Gera os ícones PNG do CapyZap (capivara) sem dependências externas."""
import struct, zlib, os, math

OUT = "/root/capyzap/public/icons"
os.makedirs(OUT, exist_ok=True)

# Paleta CapyZap
FUR       = (141, 103, 72)   # marrom capivara
FUR_DARK  = (104, 74, 49)
MUZZLE   = (196, 150, 106)
GREEN    = (61, 139, 95)     # verde WhatsApp-ish
GREEN_D   = (36, 78, 55)
WHITE    = (255, 255, 255)
BLACK    = (40, 30, 22)
EAR_IN   = (86, 58, 38)

def png_write(path, size, pixels):
    """pixels: lista de linhas, cada linha lista de (r,g,b,a)."""
    raw = b""
    for row in pixels:
        raw += b"\x00" + b"".join(bytes(p) for p in row)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))
    print(f"  {path} ({size}x{size})")

def capy_icon(size, maskable=False):
    """Desenha a capivara: fundo verde, cabeça marrom, focinho, olhos, orelhas."""
    px = []
    s = size
    # métricas relativas
    cx = s * 0.5
    head_cy = s * 0.52
    head_rx = s * (0.42 if maskable else 0.34)
    head_ry = s * (0.36 if maskable else 0.30)
    ear_r = s * (0.10 if maskable else 0.085)
    muz_rx = head_rx * 0.52
    muz_ry = head_ry * 0.55
    muz_cy = head_cy + head_ry * 0.55
    eye_r = s * 0.035

    def in_ellipse(x, y, ecx, ecy, rx, ry):
        return ((x - ecx) / rx) ** 2 + ((y - ecy) / ry) ** 2 <= 1

    for y in range(s):
        row = []
        for x in range(s):
            color = GREEN
            # fundo com leve gradiente
            t = y / s
            color = (
                int(GREEN[0] * (1 - t * 0.25)),
                int(GREEN[1] * (1 - t * 0.25)),
                int(GREEN[2] * (1 - t * 0.25)),
            )
            # círculo externo branco sutil (anel) para não-maskable
            dist = math.hypot(x - cx, y - s * 0.5) / (s * 0.5)
            if not maskable and dist > 0.96:
                color = (255, 255, 255)
            # orelhas (atrás da cabeça, topo)
            for ex, ey in [(cx - head_rx * 0.78, head_cy - head_ry * 0.82),
                           (cx + head_rx * 0.78, head_cy - head_ry * 0.82)]:
                if in_ellipse(x, y, ex, ey, ear_r, ear_r * 1.15):
                    color = FUR_DARK
                if in_ellipse(x, y, ex, ey, ear_r * 0.55, ear_r * 0.7):
                    color = EAR_IN
            # cabeça
            if in_ellipse(x, y, cx, head_cy, head_rx, head_ry):
                color = FUR
            # focinho
            if in_ellipse(x, y, cx, muz_cy, muz_rx, muz_ry):
                color = MUZZLE
            # narinas
            nry = muz_ry * 0.18
            for nx in (cx - muz_rx * 0.38, cx + muz_rx * 0.38):
                if in_ellipse(x, y, nx, muz_cy - muz_ry * 0.25, nry * 0.9, nry):
                    color = (60, 42, 28)
            # olhos
            for ex_ in (cx - head_rx * 0.42, cx + head_rx * 0.42):
                ey_ = head_cy - head_ry * 0.30
                if in_ellipse(x, y, ex_, ey_, eye_r, eye_r):
                    color = BLACK
                if in_ellipse(x, y, ex_, ey_, eye_r * 0.45, eye_r * 0.45):
                    # brilho
                    if (x - ex_) + (y - ey_) < 0:
                        color = WHITE
            # sorriso sutil
            smile_y = muz_cy + muz_ry * 0.42
            dx = x - cx
            if abs(dx) < muz_rx * 0.5 and abs((y - smile_y) - dx * dx * 0.002) < 1.2:
                color = (90, 60, 40)
            row.append((*color, 255))
        px.append(row)
    return px

# SVG da capivara (para favicon e uso vetorial)
SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="80%">
      <stop offset="0%" stop-color="#4CA66E"/>
      <stop offset="100%" stop-color="#244E37"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="96" fill="url(#bg)"/>
  <!-- orelhas -->
  <ellipse cx="160" cy="150" rx="52" ry="58" fill="#684A31"/>
  <ellipse cx="352" cy="150" rx="52" ry="58" fill="#684A31"/>
  <ellipse cx="160" cy="150" rx="26" ry="32" fill="#563A26"/>
  <ellipse cx="352" cy="150" rx="26" ry="32" fill="#563A26"/>
  <!-- cabeça -->
  <ellipse cx="256" cy="266" rx="174" ry="154" fill="#8D6748"/>
  <!-- focinho -->
  <ellipse cx="256" cy="330" rx="90" ry="84" fill="#C4966A"/>
  <!-- narinas -->
  <ellipse cx="222" cy="308" rx="12" ry="16" fill="#3C2A1C"/>
  <ellipse cx="290" cy="308" rx="12" ry="16" fill="#3C2A1C"/>
  <!-- olhos -->
  <circle cx="183" cy="222" r="18" fill="#281E16"/>
  <circle cx="329" cy="222" r="18" fill="#281E16"/>
  <circle cx="177" cy="215" r="6" fill="#FFFFFF"/>
  <circle cx="323" cy="215" r="6" fill="#FFFFFF"/>
  <!-- sorriso -->
  <path d="M226 366 Q256 382 286 366" stroke="#5A3C28" stroke-width="10"
        fill="none" stroke-linecap="round"/>
</svg>"""
with open(f"{OUT}/capy.svg", "w") as f:
    f.write(SVG)
print(f"  {OUT}/capy.svg")

for sz, maskable in [(192, False), (512, False), (512, True)]:
    name = "capy-maskable-512" if maskable else f"capy-{sz}"
    png_write(f"{OUT}/{name}.png", sz, capy_icon(sz, maskable))

print("Ícones gerados com sucesso ✅")
