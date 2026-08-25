"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { calculateProfile, layerResistance } from "./calculation.mjs";
import {
  defaultConditions,
  defaultVariants,
  materialLibrary,
  presetDefinitions,
  type Conditions,
  type Layer,
  type PresetKey,
  type Variant,
} from "./presets";

type Surfaces = { inside: number; outside: number };

const numberFormat = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2 });
const preciseFormat = new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function format(value: number, digits = 1) {
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function cloneDefaultVariants() {
  return defaultVariants.map((variant) => ({
    ...variant,
    layers: variant.layers.map((layer) => ({ ...layer })),
  }));
}

function ProfileChart({ result }: { result: ReturnType<typeof calculateProfile> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(620, container.clientWidth);
      const height = 360;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);

      const margin = { top: 30, right: 24, bottom: 46, left: 54 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      const points = result.points;
      const totalThickness = Math.max(...points.map((point) => point.positionMm), 1);
      const values = points.flatMap((point) => [point.temperature, point.dewPoint]);
      const minValue = Math.floor((Math.min(...values) - 2) / 5) * 5;
      const maxValue = Math.ceil((Math.max(...values) + 2) / 5) * 5;
      const valueSpan = Math.max(maxValue - minValue, 1);
      const x = (position: number) => margin.left + (position / totalThickness) * plotWidth;
      const y = (value: number) => margin.top + ((maxValue - value) / valueSpan) * plotHeight;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fffdfa";
      context.fillRect(0, 0, width, height);

      const gridSteps = 5;
      context.font = "11px Inter, system-ui, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let index = 0; index <= gridSteps; index += 1) {
        const value = minValue + (valueSpan * index) / gridSteps;
        const gridY = y(value);
        context.strokeStyle = "#e7e2da";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(margin.left, gridY);
        context.lineTo(width - margin.right, gridY);
        context.stroke();
        context.fillStyle = "#667776";
        context.fillText(`${format(value, 0)} °C`, margin.left - 9, gridY);
      }

      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        if (previous.dewPoint > previous.temperature || current.dewPoint > current.temperature) {
          context.fillStyle = "rgba(166, 67, 54, .075)";
          context.fillRect(x(previous.positionMm), margin.top, Math.max(1, x(current.positionMm) - x(previous.positionMm)), plotHeight);
        }
      }

      const layerInterfaces = result.interfaces.filter((point) => point.layerId);
      context.textAlign = "center";
      context.textBaseline = "top";
      for (const point of layerInterfaces) {
        const gridX = x(point.positionMm);
        context.strokeStyle = "rgba(23, 59, 58, .12)";
        context.beginPath();
        context.moveTo(gridX, margin.top);
        context.lineTo(gridX, margin.top + plotHeight);
        context.stroke();
      }

      const drawLine = (key: "temperature" | "dewPoint", color: string, dashed: boolean) => {
        context.strokeStyle = color;
        context.lineWidth = 2.6;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.setLineDash(dashed ? [7, 6] : []);
        context.beginPath();
        points.forEach((point, index) => {
          const pointX = x(point.positionMm);
          const pointY = y(point[key]);
          if (index === 0) context.moveTo(pointX, pointY);
          else context.lineTo(pointX, pointY);
        });
        context.stroke();
        context.setLineDash([]);
      };

      drawLine("temperature", "#173b3a", false);
      drawLine("dewPoint", "#d46f42", true);

      context.fillStyle = "#667776";
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText("Interiér", margin.left, height - 28);
      context.textAlign = "right";
      context.fillText("Exteriér", width - margin.right, height - 28);
      context.textAlign = "center";
      context.fillText(`${numberFormat.format(totalThickness)} mm`, margin.left + plotWidth / 2, height - 28);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [result]);

  return (
    <div className="chart-scroll">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Graf průběhu teploty a rosného bodu od interiéru k exteriéru"
      />
    </div>
  );
}

function ConditionInput({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <span className="input-shell">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step="1"
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <b>{unit}</b>
      </span>
    </label>
  );
}

export default function RoofCalculator() {
  const [conditions, setConditions] = useState<Conditions>({ ...defaultConditions });
  const [surfaces, setSurfaces] = useState<Surfaces>({ inside: 0.1, outside: 0.04 });
  const [variants, setVariants] = useState<Variant[]>(cloneDefaultVariants);
  const [activeId, setActiveId] = useState("with-wool");
  const [materialIndex, setMaterialIndex] = useState(3);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("roof-physics-project-v1");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.conditions && parsed.surfaces && Array.isArray(parsed.variants)) {
            setConditions(parsed.conditions);
            setSurfaces(parsed.surfaces);
            setVariants(parsed.variants);
            setActiveId(parsed.activeId || parsed.variants[0]?.id || "with-wool");
          }
        }
      } catch {
        // Poškozené lokální nastavení nesmí zablokovat kalkulačku.
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      "roof-physics-project-v1",
      JSON.stringify({ conditions, surfaces, variants, activeId }),
    );
  }, [activeId, conditions, hydrated, surfaces, variants]);

  const activeVariant = variants.find((variant) => variant.id === activeId) ?? variants[0];
  const comparison = useMemo(
    () => variants.map((variant) => ({ variant, result: calculateProfile(variant.layers, conditions, surfaces) })),
    [conditions, surfaces, variants],
  );
  const activeResult = comparison.find(({ variant }) => variant.id === activeVariant?.id)?.result
    ?? calculateProfile([], conditions, surfaces);

  const updateCondition = (key: keyof Conditions, value: number) => {
    setConditions((current) => ({ ...current, [key]: value }));
  };

  const updateVariant = (variantId: string, updater: (variant: Variant) => Variant) => {
    setVariants((current) => current.map((variant) => variant.id === variantId ? updater(variant) : variant));
  };

  const updateLayer = (layerId: string, changes: Partial<Layer>) => {
    updateVariant(activeVariant.id, (variant) => ({
      ...variant,
      layers: variant.layers.map((layer) => layer.id === layerId ? { ...layer, ...changes } : layer),
    }));
  };

  const moveLayer = (index: number, direction: -1 | 1) => {
    updateVariant(activeVariant.id, (variant) => {
      const next = [...variant.layers];
      const target = index + direction;
      if (target < 0 || target >= next.length) return variant;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...variant, layers: next };
    });
  };

  const duplicateLayer = (layerToCopy: Layer, index: number) => {
    updateVariant(activeVariant.id, (variant) => {
      const next = [...variant.layers];
      next.splice(index + 1, 0, { ...layerToCopy, id: `${layerToCopy.id}-copy-${Date.now()}`, name: `${layerToCopy.name} – kopie` });
      return { ...variant, layers: next };
    });
  };

  const removeLayer = (layerId: string) => {
    updateVariant(activeVariant.id, (variant) => ({ ...variant, layers: variant.layers.filter((layer) => layer.id !== layerId) }));
  };

  const addMaterial = () => {
    const selected = materialLibrary[materialIndex];
    const newLayer = { ...selected, id: `custom-${Date.now()}` } as Layer;
    updateVariant(activeVariant.id, (variant) => ({ ...variant, layers: [...variant.layers, newLayer] }));
  };

  const applyPreset = (presetKey: PresetKey) => {
    const preset = presetDefinitions[presetKey];
    updateVariant(activeVariant.id, (variant) => ({
      ...variant,
      name: preset.label.split(" – ")[0],
      description: preset.description,
      layers: preset.make(`${variant.id}-${Date.now()}`),
    }));
  };

  const resetProject = () => {
    if (!window.confirm("Obnovit původní zadání střechy? Vlastní úpravy se smažou.")) return;
    setConditions({ ...defaultConditions });
    setSurfaces({ inside: 0.1, outside: 0.04 });
    setVariants(cloneDefaultVariants());
    setActiveId("with-wool");
  };

  const download = (filename: string, content: string, type: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type }));
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const exportProject = () => {
    download(
      "stresni-skladba.json",
      JSON.stringify({ version: 1, conditions, surfaces, variants }, null, 2),
      "application/json",
    );
  };

  const exportCsv = () => {
    const rows = [
      ["Místo", "Poloha [mm]", "Teplota [°C]", "Rosný bod [°C]", "Nasycení [%]"],
      ...activeResult.interfaces.map((point) => [
        point.label,
        format(point.positionMm, 1),
        format(point.temperature, 2),
        format(point.dewPoint, 2),
        format(point.saturationRatio, 1),
      ]),
    ];
    download(
      `vysledky-${activeVariant.id}.csv`,
      `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`,
      "text/csv;charset=utf-8",
    );
  };

  const statusCopy = activeResult.status === "risk"
    ? { label: "Riziko kondenzace", detail: activeResult.firstRisk ? `První kritická oblast: ${activeResult.firstRisk.layerName}` : "Křivky se protínají uvnitř skladby." }
    : activeResult.status === "warning"
      ? { label: "Blízko nasycení", detail: "Nejvyšší vypočtené nasycení je nad 95 %." }
      : { label: "Bez průsečíku", detail: "Teplota zůstá nad rosným bodem ve všech vrstvách." };

  return (
    <main>
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">θ</span><span>Střešní fyzika</span></div>
        <div className="top-actions">
          <button className="text-button" type="button" onClick={resetProject}>Obnovit zadání</button>
          <button className="outline-button" type="button" onClick={exportProject}>Stáhnout konfiguraci</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">TEPLOTA · ROSNÝ BOD · KONDENZACE</p>
          <h1>Ověřte skladbu střechy vrstvu po vrstvě.</h1>
          <p className="intro">Upravte podmínky, materiály a varianty. Kalkulačka okamžitě ukáže tepelný odpor, průběh teplot a místa, kde teplota klesá pod rosný bod.</p>
        </div>
        <aside className={`summary-card ${activeResult.status}`}>
          <span className="summary-label">{activeVariant.name}</span>
          <strong>{statusCopy.label}</strong>
          <span>{statusCopy.detail}</span>
        </aside>
      </section>

      <section className="conditions-panel" aria-label="Okrajové podmínky">
        <div className="section-heading">
          <div><span className="step">01</span><h2>Vnitřní a vnější podmínky</h2></div>
          <span className="muted">Změny se ukládají v tomto zařízení</span>
        </div>
        <div className="condition-grid">
          <ConditionInput label="Vnitřní teplota" value={conditions.insideTemperature} unit="°C" min={-30} max={50} onChange={(value) => updateCondition("insideTemperature", value)} />
          <ConditionInput label="Vnitřní vlhkost" value={conditions.insideHumidity} unit="%" min={0} max={100} onChange={(value) => updateCondition("insideHumidity", value)} />
          <ConditionInput label="Venkovní teplota" value={conditions.outsideTemperature} unit="°C" min={-50} max={50} onChange={(value) => updateCondition("outsideTemperature", value)} />
          <ConditionInput label="Venkovní vlhkost" value={conditions.outsideHumidity} unit="%" min={0} max={100} onChange={(value) => updateCondition("outsideHumidity", value)} />
        </div>
        <details className="advanced-settings">
          <summary>Povrchové odpory a metodika</summary>
          <div className="advanced-grid">
            <label>Vnitřní odpor R<sub>si</sub><input type="number" step="0.01" min="0" value={surfaces.inside} onChange={(event) => setSurfaces((current) => ({ ...current, inside: Number(event.target.value) }))} /></label>
            <label>Vnější odpor R<sub>se</sub><input type="number" step="0.01" min="0" value={surfaces.outside} onChange={(event) => setSurfaces((current) => ({ ...current, outside: Number(event.target.value) }))} /></label>
            <p>Výchozí hodnoty 0,10 a 0,04 m²K/W odpovídají toku tepla vzhůru přes střechu. Podhled propojený svítidly s interiérem není ve výchozí skladbě započítán.</p>
          </div>
        </details>
      </section>

      <section className="comparison-section">
        <div className="section-heading simple-heading">
          <div><span className="step">02</span><h2>Porovnání variant</h2></div>
          <span className="muted">Vyberte variantu, kterou chcete upravovat</span>
        </div>
        <div className="comparison-grid">
          {comparison.map(({ variant, result }) => (
            <button key={variant.id} type="button" className={`variant-card ${variant.id === activeVariant.id ? "active" : ""}`} onClick={() => setActiveId(variant.id)}>
              <span className={`status-dot ${result.status}`} aria-hidden="true" />
              <span className="variant-copy"><strong>{variant.name}</strong><small>{variant.description}</small></span>
              <span className="variant-stat"><b>{preciseFormat.format(result.uValue)}</b><small>W/(m²K)</small></span>
              <span className="variant-stat"><b>{format(result.maxSaturation, 0)} %</b><small>max. nasycení</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <span className="step">03</span>
            <div><h2>Vrstvy varianty „{activeVariant.name}“</h2><p>Pořadí je vždy od interiéru k exteriéru.</p></div>
          </div>
          <div className="toolbar-controls">
            <label className="select-label">Načíst řez
              <select defaultValue="" onChange={(event) => { if (event.target.value) applyPreset(event.target.value as PresetKey); event.target.value = ""; }}>
                <option value="" disabled>Vyberte předvolbu</option>
                {Object.entries(presetDefinitions).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="layer-table-wrap">
          <table className="layer-table editable-table">
            <thead>
              <tr><th>Zap.</th><th>Materiál</th><th>d [mm]</th><th>λ [W/mK]</th><th>μ [–]</th><th>Vlastní R</th><th>Vlastní sd [m]</th><th>Výsledné R / sd</th><th>Akce</th></tr>
            </thead>
            <tbody>
              {activeVariant.layers.map((layer, index) => {
                const resistance = layerResistance(layer);
                return (
                  <tr key={layer.id} className={layer.enabled ? "" : "disabled-row"}>
                    <td><input aria-label={`Zahrnout ${layer.name}`} type="checkbox" checked={layer.enabled} onChange={(event) => updateLayer(layer.id, { enabled: event.target.checked })} /></td>
                    <td className="material-cell"><span className="material-swatch" style={{ background: layer.color }} /><input aria-label="Název materiálu" value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />{layer.note && <small title={layer.note}>i</small>}</td>
                    <td><input aria-label={`Tloušťka ${layer.name}`} type="number" min="0" step="0.1" value={layer.thicknessMm} onChange={(event) => updateLayer(layer.id, { thicknessMm: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Lambda ${layer.name}`} type="number" min="0.001" step="0.001" value={layer.lambda} onChange={(event) => updateLayer(layer.id, { lambda: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Mí ${layer.name}`} type="number" min="0" step="1" value={layer.mu} onChange={(event) => updateLayer(layer.id, { mu: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Vlastní R ${layer.name}`} type="number" min="0" step="0.01" placeholder="auto" value={layer.fixedR ?? ""} onChange={(event) => updateLayer(layer.id, { fixedR: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                    <td><input aria-label={`Vlastní sd ${layer.name}`} type="number" min="0" step="0.01" placeholder="auto" value={layer.fixedSd ?? ""} onChange={(event) => updateLayer(layer.id, { fixedSd: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                    <td className="calculated-cell"><b>{format(resistance.thermal, 3)}</b><small>{format(resistance.diffusion, 2)} m</small></td>
                    <td><div className="row-actions">
                      <button type="button" disabled={index === 0} onClick={() => moveLayer(index, -1)} title="Posunout nahoru">↑</button>
                      <button type="button" disabled={index === activeVariant.layers.length - 1} onClick={() => moveLayer(index, 1)} title="Posunout dolů">↓</button>
                      <button type="button" onClick={() => duplicateLayer(layer, index)} title="Duplikovat">⧉</button>
                      <button type="button" onClick={() => removeLayer(layer.id)} title="Odstranit">×</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="add-layer-bar">
          <select aria-label="Materiál k přidání" value={materialIndex} onChange={(event) => setMaterialIndex(Number(event.target.value))}>
            {materialLibrary.map((material, index) => <option value={index} key={`${material.name}-${index}`}>{material.name}</option>)}
          </select>
          <button className="primary-button" type="button" onClick={addMaterial}>+ Přidat vrstvu</button>
          <p>Prázdné vlastní R a sd se vypočtou z tloušťky, λ a μ. Vlastní hodnoty mají přednost.</p>
        </div>
      </section>

      <section className="metric-row" aria-label="Souhrn výsledků">
        <article><span>Součinitel prostupu U</span><strong>{preciseFormat.format(activeResult.uValue)}</strong><small>W/(m²K)</small></article>
        <article><span>Celkový tepelný odpor</span><strong>{format(activeResult.totalThermal, 2)}</strong><small>m²K/W</small></article>
        <article><span>Tepelný tok</span><strong>{format(Math.abs(activeResult.heatFlux), 2)}</strong><small>W/m²</small></article>
        <article className={activeResult.status === "risk" ? "danger-metric" : "safe-metric"}><span>Maximum nasycení</span><strong>{format(activeResult.maxSaturation, 0)}</strong><small>%</small></article>
      </section>

      <section className="results-grid">
        <article className="result-panel chart-panel">
          <div className="result-heading"><div><span className="step">04</span><h2>Průběh konstrukcí</h2></div><div className="legend"><span className="temperature-line">Teplota</span><span className="dew-line">Rosný bod</span><span className="risk-zone">Riziková oblast</span></div></div>
          <ProfileChart result={activeResult} />
        </article>
        <aside className={`finding-panel ${activeResult.status}`}>
          <span className="summary-label">Interpretace</span>
          <h2>{statusCopy.label}</h2>
          <p>{statusCopy.detail}</p>
          {activeResult.firstRisk && <dl><div><dt>Poloha od interiéru</dt><dd>{format(activeResult.firstRisk.positionMm, 0)} mm</dd></div><div><dt>Teplota</dt><dd>{format(activeResult.firstRisk.temperature, 1)} °C</dd></div><div><dt>Rosný bod</dt><dd>{format(activeResult.firstRisk.dewPoint, 1)} °C</dd></div></dl>}
          <p className="fine-print">Nasycení nad 100 % označuje teoretický přebytek vodní páry. Ve skutečnosti se tlak omezí kondenzací.</p>
        </aside>
      </section>

      <section className="interfaces-panel">
        <div className="section-heading">
          <div><span className="step">05</span><h2>Výsledky na rozhraní vrstev</h2></div>
          <button className="outline-button" type="button" onClick={exportCsv}>Stáhnout CSV</button>
        </div>
        <div className="layer-table-wrap">
          <table className="result-table">
            <thead><tr><th>Místo</th><th>Poloha</th><th>Teplota</th><th>Rosný bod</th><th>Nasycení</th><th>Hodnocení</th></tr></thead>
            <tbody>{activeResult.interfaces.map((point, index) => (
              <tr key={`${point.label}-${index}`}>
                <td>{point.label}</td><td>{format(point.positionMm, 1)} mm</td><td>{format(point.temperature, 2)} °C</td><td>{format(point.dewPoint, 2)} °C</td><td>{format(point.saturationRatio, 1)} %</td>
                <td><span className={`result-badge ${point.saturationRatio >= 100 ? "risk" : point.saturationRatio >= 95 ? "warning" : "safe"}`}>{point.saturationRatio >= 100 ? "Kondenzace" : point.saturationRatio >= 95 ? "Na hraně" : "Bez průsečíku"}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="method-panel">
        <h2>Co tento výpočet znamená</h2>
        <div className="method-columns">
          <p><strong>Umí:</strong> stacionární jednorozměrný profil teploty a vodní páry, rosný bod, tepelný odpor, U a vyhledání teoretických kondenzačních oblastí.</p>
          <p><strong>Neumí:</strong> roční vysychání, déšť, sluneční zisky, zabudovanou vlhkost, proudění netěsnostmi ani přesné 2D křížení trámů.</p>
          <p><strong>Použití:</strong> vhodné pro porovnání variant a odhalení problémových skladeb. Pro realizační projekt ověřte výsledek měsíčním nebo dynamickým výpočtem.</p>
        </div>
      </section>

      <footer><span>Střešní fyzika</span><span>Výpočet pracuje pouze s údaji uloženými ve vašem prohlížeči.</span></footer>
    </main>
  );
}
