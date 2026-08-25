# Kalkulačka střešní skladby

Konfigurovatelná webová aplikace pro porovnání průběhu teploty, rosného bodu
a teoretického rizika kondenzace ve střešní konstrukci.

**Online aplikace:**
[backslash47.github.io/kalkulacka-stresni-skladby](https://backslash47.github.io/kalkulacka-stresni-skladby/)

## Funkce

- dvě nezávisle upravitelné varianty skladby,
- výchozí řezy s minerální vatou a bez ní,
- předvolby běžného pole a kritických řezů přes trámy,
- nastavení teplot, relativních vlhkostí a povrchových odporů,
- úprava tloušťky, součinitele tepelné vodivosti λ, difuzního faktoru μ,
  tepelného odporu R a ekvivalentní difuzní tloušťky sd,
- graf teploty a rosného bodu,
- tabulka výsledků na rozhraních vrstev,
- zjednodušená měsíční bilance kondenzace a vysychání s upravitelným klimatem,
- graf a tabulka nahromaděné vlhkosti v průběhu roku,
- export konfigurace do JSON a obou výpočtů do CSV,
- automatické uložení rozpracovaného zadání v prohlížeči.

## Metodika a omezení

Základní výpočet je stacionární a jednorozměrný. Používá rozdělení teplot
podle tepelných odporů a rozdělení parciálního tlaku vodní páry podle hodnot
sd. Měsíční část navíc vyčísluje difuzní kondenzaci a dostupné odpařování na
jednotlivých rozhraních a zobrazí nejnepříznivější z nich. Výchozí venkovní
data jsou měsíční klimatologie NASA POWER 2001–2020 pro Brno.

Jde o zjednodušený měsíční Glaserův screening, nikoli dynamickou hygrotermickou
simulaci. Neřeší déšť, sluneční a dlouhovlnné záření, zabudovanou vlhkost,
kapilární transport, proudění vzduchu netěsnostmi ani přesný dvourozměrný vliv
křížení trámů.

## Lokální spuštění

Vyžaduje Node.js 22 nebo novější.

```bash
npm install
npm run dev
```

Statickou verzi pro GitHub Pages vytvoří:

```bash
npm run build:pages
```

Kontroly projektu:

```bash
npm test
npm run lint
```

Každý push do větve `main` automaticky sestaví a nasadí aplikaci pomocí
workflow v `.github/workflows/pages.yml`.
