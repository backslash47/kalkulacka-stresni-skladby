"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { calculateMonthlyBalance, calculateProfile, layerResistance } from "./calculation.mjs";
import {
  defaultConditions,
  defaultMonthlyClimate,
  defaultVariants,
  materialLibrary,
  presetDefinitions,
  type Conditions,
  type Layer,
  type MonthlyClimate,
  type PresetKey,
  type Variant,
} from "./presets";

type Surfaces = { inside: number; outside: number };
type AirTightness = "continuous" | "uncertain" | "leaky";
type WoodSettings = { airTightness: AirTightness };

const defaultWoodSettings: WoodSettings = { airTightness: "leaky" };

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

function cloneDefaultMonthlyClimate() {
  return defaultMonthlyClimate.map((month) => ({ ...month }));
}

function inferredWoodKind(layer: Layer): "none" | "solid" | "osb" {
  if (layer.woodKind) return layer.woodKind;
  const name = layer.name.toLocaleLowerCase("cs");
  if (/osb|dřevotří|drevotri/.test(name)) return "osb";
  return /dřev|drev|smrk|trám|tram|bedněn|bednen/.test(name) ? "solid" : "none";
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

type MonthlyChartData = {
  peakStoredGm2: number;
  months: Array<{
    month: string;
    condensationGm2: number;
    evaporationGm2: number;
    storedGm2: number;
  }>;
};

function MonthlyBalanceChart({ result }: { result: MonthlyChartData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || result.months.length === 0) return;
    const container = canvas.parentElement;
    if (!container) return;

    const draw = () => {
      const width = Math.max(720, container.clientWidth);
      const height = 340;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);

      const margin = { top: 32, right: 64, bottom: 48, left: 60 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      const flowMaximum = Math.max(
        1,
        ...result.months.flatMap((month) => [month.condensationGm2, month.evaporationGm2]),
      );
      const storedMaximum = Math.max(1, result.peakStoredGm2);
      const flowLimit = Math.ceil(flowMaximum / 10) * 10;
      const xStep = plotWidth / result.months.length;
      const zeroY = margin.top + plotHeight / 2;
      const flowY = (value: number) => zeroY - (value / flowLimit) * (plotHeight / 2 - 12);
      const storedY = (value: number) => margin.top + plotHeight - (value / storedMaximum) * plotHeight;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fffdfa";
      context.fillRect(0, 0, width, height);
      context.font = "11px Inter, system-ui, sans-serif";
      context.textBaseline = "middle";

      for (let index = 0; index <= 4; index += 1) {
        const gridY = margin.top + (plotHeight * index) / 4;
        context.strokeStyle = index === 2 ? "#bcb7ad" : "#e7e2da";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(margin.left, gridY);
        context.lineTo(width - margin.right, gridY);
        context.stroke();
      }

      result.months.forEach((month, index) => {
        const centerX = margin.left + xStep * index + xStep / 2;
        const barWidth = Math.min(22, xStep * 0.32);
        if (month.condensationGm2 > 0) {
          const barY = flowY(month.condensationGm2);
          context.fillStyle = "rgba(166, 67, 54, .76)";
          context.fillRect(centerX - barWidth - 1, barY, barWidth, zeroY - barY);
        }
        if (month.evaporationGm2 > 0) {
          const barY = flowY(-month.evaporationGm2);
          context.fillStyle = "rgba(45, 120, 98, .7)";
          context.fillRect(centerX + 1, zeroY, barWidth, barY - zeroY);
        }
        context.fillStyle = "#667776";
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(month.month.slice(0, 3), centerX, height - 31);
      });

      context.strokeStyle = "#173b3a";
      context.fillStyle = "#173b3a";
      context.lineWidth = 2.6;
      context.lineJoin = "round";
      context.beginPath();
      result.months.forEach((month, index) => {
        const pointX = margin.left + xStep * index + xStep / 2;
        const pointY = storedY(month.storedGm2);
        if (index === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      });
      context.stroke();
      result.months.forEach((month, index) => {
        const pointX = margin.left + xStep * index + xStep / 2;
        const pointY = storedY(month.storedGm2);
        context.beginPath();
        context.arc(pointX, pointY, 3.2, 0, Math.PI * 2);
        context.fill();
      });

      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillStyle = "#667776";
      context.fillText(`${format(flowLimit, 0)}`, margin.left - 9, flowY(flowLimit));
      context.fillText("0", margin.left - 9, zeroY);
      context.fillText(`−${format(flowLimit, 0)}`, margin.left - 9, flowY(-flowLimit));
      context.textAlign = "left";
      context.fillText(`${format(storedMaximum, 0)} g/m²`, width - margin.right + 9, storedY(storedMaximum));
      context.fillText("0", width - margin.right + 9, storedY(0));
      context.textBaseline = "top";
      context.fillStyle = "#173b3a";
      context.textAlign = "left";
      context.fillText("Měsíční bilance [g/m²]", margin.left, 10);
      context.textAlign = "right";
      context.fillText("Nahromaděno [g/m²]", width - margin.right, 10);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [result]);

  return (
    <div className="chart-scroll monthly-chart">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Graf měsíční kondenzace, odpařování a nahromaděné vlhkosti"
      />
    </div>
  );
}

function HelpTerm({
  label,
  help,
  align = "center",
}: {
  label: string;
  help: string;
  align?: "left" | "center" | "right";
}) {
  const tooltipId = useId();

  return (
    <button
      type="button"
      className={`help-term help-${align}`}
      title={help}
      aria-describedby={tooltipId}
      aria-label={`${label}: ${help}`}
    >
      <span>{label}</span>
      <span className="help-symbol" aria-hidden="true">?</span>
      <span className="help-tooltip" id={tooltipId} role="tooltip">{help}</span>
    </button>
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
  const [monthlyClimate, setMonthlyClimate] = useState<MonthlyClimate[]>(cloneDefaultMonthlyClimate);
  const [surfaces, setSurfaces] = useState<Surfaces>({ inside: 0.1, outside: 0.04 });
  const [variants, setVariants] = useState<Variant[]>(cloneDefaultVariants);
  const [activeId, setActiveId] = useState("with-wool");
  const [materialIndex, setMaterialIndex] = useState(3);
  const [monthlyViewId, setMonthlyViewId] = useState("all");
  const [woodViewId, setWoodViewId] = useState("");
  const [woodSettings, setWoodSettings] = useState<WoodSettings>({ ...defaultWoodSettings });
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
            if (Array.isArray(parsed.monthlyClimate) && parsed.monthlyClimate.length === 12) {
              setMonthlyClimate(parsed.monthlyClimate);
            }
            if (["continuous", "uncertain", "leaky"].includes(parsed.woodSettings?.airTightness)) {
              setWoodSettings(parsed.woodSettings);
            }
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
      JSON.stringify({ conditions, monthlyClimate, surfaces, variants, activeId, woodSettings }),
    );
  }, [activeId, conditions, hydrated, monthlyClimate, surfaces, variants, woodSettings]);

  const activeVariant = variants.find((variant) => variant.id === activeId) ?? variants[0];
  const comparison = useMemo(
    () => variants.map((variant) => ({ variant, result: calculateProfile(variant.layers, conditions, surfaces) })),
    [conditions, surfaces, variants],
  );
  const activeResult = comparison.find(({ variant }) => variant.id === activeVariant?.id)?.result
    ?? calculateProfile([], conditions, surfaces);
  const activePeakLayer = activeVariant?.layers.find((layer) => layer.id === activeResult.peakRisk?.layerId);
  const monthlyResult = useMemo(
    () => calculateMonthlyBalance(activeVariant?.layers ?? [], monthlyClimate, surfaces, woodSettings),
    [activeVariant, monthlyClimate, surfaces, woodSettings],
  );
  const monthlyViews = useMemo(() => [
    {
      id: "all",
      label: "Celá skladba",
      months: monthlyResult.months,
      annualCondensationGm2: monthlyResult.annualCondensationGm2,
      annualEvaporationGm2: monthlyResult.annualEvaporationGm2,
      annualChangeGm2: monthlyResult.annualChangeGm2,
      peakStoredGm2: monthlyResult.peakStoredGm2,
    },
    ...monthlyResult.locations,
  ], [monthlyResult]);
  const monthlyView = monthlyViews.find((view) => view.id === monthlyViewId) ?? monthlyViews[0];
  const woodAssessment = monthlyResult.woodAssessment;
  const woodView = woodAssessment.elements.find((element) => element.id === woodViewId)
    ?? woodAssessment.elements[0]
    ?? null;

  const updateCondition = (key: keyof Conditions, value: number) => {
    setConditions((current) => ({ ...current, [key]: value }));
  };

  const updateMonthlyClimate = (monthId: string, key: keyof Conditions, value: number) => {
    setMonthlyClimate((current) => current.map((month) => (
      month.id === monthId ? { ...month, [key]: value } : month
    )));
  };

  const applyIndoorConditionsToYear = () => {
    setMonthlyClimate((current) => current.map((month) => ({
      ...month,
      insideTemperature: conditions.insideTemperature,
      insideHumidity: conditions.insideHumidity,
    })));
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

  const updateWoodKind = (layer: Layer, woodKind: "none" | "solid" | "osb") => {
    updateLayer(layer.id, {
      woodKind,
      densityKgM3: woodKind === "osb" ? 600 : woodKind === "solid" ? 450 : layer.densityKgM3,
      initialMoisturePercent: woodKind === "osb" ? 10 : woodKind === "solid" ? 12 : layer.initialMoisturePercent,
    });
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
    setMonthlyClimate(cloneDefaultMonthlyClimate());
    setSurfaces({ inside: 0.1, outside: 0.04 });
    setVariants(cloneDefaultVariants());
    setActiveId("with-wool");
    setWoodSettings({ ...defaultWoodSettings });
    setWoodViewId("");
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
      JSON.stringify({ version: 3, conditions, monthlyClimate, surfaces, variants, woodSettings }, null, 2),
      "application/json",
    );
  };

  const exportMonthlyCsv = () => {
    const exportViews = [
      { id: "all", label: "Celá skladba", months: monthlyResult.months },
      ...monthlyResult.locations,
    ];
    const rows = [
      ["Místo", "Měsíc", "Ti [°C]", "RHi [%]", "Te [°C]", "RHe [%]", "Kondenzace [g/m²]", "Odpaření [g/m²]", "Nahromaděno [g/m²]"],
      ...exportViews.flatMap((view) => view.months.map((month) => [
          view.label,
          month.month,
          format(month.insideTemperature, 1),
          format(month.insideHumidity, 1),
          format(month.outsideTemperature, 1),
          format(month.outsideHumidity, 1),
          format(month.condensationGm2, 2),
          format(month.evaporationGm2, 2),
          format(month.storedGm2, 2),
        ])),
    ];
    download(
      `mesicni-bilance-${activeVariant.id}.csv`,
      `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`,
      "text/csv;charset=utf-8",
    );
  };

  const exportWoodCsv = () => {
    const rows = [
      ["Prvek", "Typ", "Měsíc", "Teplota kritického místa [°C]", "RH kritického místa [%]", "Rovnovážná vlhkost dřeva [%]", "Kondenzace v kontaktu [g/m²]", "Uložený kondenzát v kontaktu [g/m²]"],
      ...woodAssessment.elements.flatMap((element) => element.months.map((month) => [
        element.label,
        element.woodKindLabel,
        month.month,
        format(month.temperature, 2),
        format(month.relativeHumidity, 1),
        format(month.equilibriumMoisturePercent, 2),
        format(month.condensationGm2, 2),
        format(month.storedGm2, 2),
      ])),
    ];
    download(
      `riziko-dreva-${activeVariant.id}.csv`,
      `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`,
      "text/csv;charset=utf-8",
    );
  };

  const exportCsv = () => {
    const rows = [
      ["Místo", "Poloha [mm]", "Teplota [°C]", "Rosný bod [°C]", "Relativní vlhkost [%]", "Kondenzační poměr p/ps [–]"],
      ...activeResult.interfaces.map((point) => [
        point.label,
        format(point.positionMm, 1),
        format(point.temperature, 2),
        format(point.dewPoint, 2),
        format(point.relativeHumidity, 1),
        point.condensationRatio > 1 ? format(point.condensationRatio, 2) : "",
      ]),
    ];
    download(
      `vysledky-${activeVariant.id}.csv`,
      `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")}`,
      "text/csv;charset=utf-8",
    );
  };

  const statusCopy = activeResult.status === "risk"
    ? {
      label: "Kondenzační potenciál",
      detail: activeResult.firstRisk
        ? `Kritický úsek začíná ${activeResult.firstRisk.locationLabel}; maximum: ${activeResult.peakRisk?.locationLabel ?? activeResult.firstRisk.locationLabel}.`
        : "Teplota klesá pod rosný bod uvnitř skladby.",
    }
    : activeResult.status === "warning"
      ? { label: "Blízko kondenzaci", detail: "Teoretický poměr parciálního a nasyceného tlaku je nad 0,95×." }
      : { label: "Bez průsečíku", detail: "Teplota zůstává nad rosným bodem ve všech vrstvách." };

  const monthlyStatusCopy = monthlyResult.status === "risk"
    ? { label: "Vlhkost mezi roky narůstá", detail: "Jedno nebo více kondenzačních míst nemá v ročním cyklu dostatečnou kapacitu vyschnout." }
    : monthlyResult.status === "warning"
      ? monthlyResult.fullyDries
        ? { label: "Sezónně kondenzuje, ale vyschne", detail: "Během chladné části roku vzniká kondenzát, který se v ročním cyklu zcela odpaří." }
        : { label: "Sezónně kondenzuje, bilance je vyrovnaná", detail: "Mezi roky vlhkost nenarůstá, ale model v žádném měsíci neukazuje úplné vyschnutí celé skladby." }
      : { label: "Bez měsíční kondenzace", detail: "V žádném měsíci nevzniká v posuzované skladbě kladná bilance kondenzace." };
  const woodStatusCopy = woodAssessment.status === "risk"
    ? { label: "Vysoké vlhkostní riziko dřeva", detail: "Nejnepříznivější prvek překračuje screeningové meze, má vysokou počáteční vlhkost nebo u něj zásoba kondenzátu narůstá." }
    : woodAssessment.computedStatus === "safe" && woodAssessment.status === "warning"
      ? { label: "Difuzně příznivé, ale netěsnost zůstává", detail: "Měsíční difuzní model nevykazuje kritickou vlhkost dřeva. Netěsný podhled však může přivést do skladby další vlhkost prouděním, kterou číselný výsledek neobsahuje." }
      : woodAssessment.status === "warning"
        ? { label: "Zvýšené vlhkostní riziko", detail: "Alespoň jeden dřevěný prvek se dostává do zvýšené vlhkosti nebo do kontaktu s kondenzátem." }
        : { label: "Nízké riziko v difuzním modelu", detail: "Dřevěné prvky zůstávají pod screeningovými mezemi a model u nich nezachytil kapalný kondenzát." };

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
            <div className="advanced-field"><HelpTerm label="Vnitřní odpor Rsi" help="Odpor při přestupu tepla mezi vnitřním vzduchem a vnitřním povrchem konstrukce, v m²K/W." align="left" /><input aria-label="Vnitřní povrchový odpor Rsi" type="number" step="0.01" min="0" value={surfaces.inside} onChange={(event) => setSurfaces((current) => ({ ...current, inside: Number(event.target.value) }))} /></div>
            <div className="advanced-field"><HelpTerm label="Vnější odpor Rse" help="Odpor při přestupu tepla mezi vnějším povrchem konstrukce a venkovním vzduchem, v m²K/W." align="left" /><input aria-label="Vnější povrchový odpor Rse" type="number" step="0.01" min="0" value={surfaces.outside} onChange={(event) => setSurfaces((current) => ({ ...current, outside: Number(event.target.value) }))} /></div>
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
              <span className="variant-stat"><b>{format(Math.min(100, result.maxSaturation), 0)} %</b><small>{result.maxSaturation >= 100 ? `RH · potenciál ${format(result.maxSaturation / 100, 2)}×` : "max. relativní vlhkost"}</small></span>
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
              <tr>
                <th><HelpTerm label="Zap." help="Určuje, zda je vrstva zahrnuta do výpočtu." align="left" /></th>
                <th>Materiál</th>
                <th><HelpTerm label="d [mm]" help="Tloušťka vrstvy v milimetrech." /></th>
                <th><HelpTerm label="λ [W/(m·K)]" help="Součinitel tepelné vodivosti. Nižší λ znamená při stejné tloušťce lepší tepelnou izolaci." /></th>
                <th><HelpTerm label="μ [–]" help="Faktor difuzního odporu vůči vodní páře. Vyšší μ znamená menší propustnost pro vodní páru." /></th>
                <th><HelpTerm label="Vlastní R" help="Ručně zadaný tepelný odpor vrstvy v m²K/W. Pokud pole zůstane prázdné, vypočte se z d a λ." /></th>
                <th><HelpTerm label="Vlastní sd [m]" help="Ručně zadaná ekvivalentní difuzní tloušťka. Pokud pole zůstane prázdné, vypočte se jako tloušťka × μ." /></th>
                <th><HelpTerm label="Dřevěný prvek" help="Určuje, zda se pro vrstvu vyhodnotí vlhkostní riziko rostlého dřeva nebo OSB/desky." /></th>
                <th><HelpTerm label="ρ / u₀" help="Objemová hmotnost dřeva ρ v kg/m³ a předpokládaná počáteční hmotnostní vlhkost u₀ v procentech." /></th>
                <th><HelpTerm label="Výsledné R / sd" help="Tepelný odpor R v m²K/W a ekvivalentní difuzní tloušťka sd v metrech, které výpočet skutečně používá." /></th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody>
              {activeVariant.layers.map((layer, index) => {
                const resistance = layerResistance(layer);
                const woodKind = inferredWoodKind(layer);
                const densityKgM3 = layer.densityKgM3 ?? (woodKind === "osb" ? 600 : 450);
                const initialMoisturePercent = layer.initialMoisturePercent ?? (woodKind === "osb" ? 10 : 12);
                return (
                  <tr key={layer.id} className={layer.enabled ? "" : "disabled-row"}>
                    <td><input aria-label={`Zahrnout ${layer.name}`} type="checkbox" checked={layer.enabled} onChange={(event) => updateLayer(layer.id, { enabled: event.target.checked })} /></td>
                    <td className="material-cell"><span className="material-swatch" style={{ background: layer.color }} /><input aria-label="Název materiálu" value={layer.name} onChange={(event) => updateLayer(layer.id, { name: event.target.value })} />{layer.note && <small title={layer.note}>i</small>}</td>
                    <td><input aria-label={`Tloušťka ${layer.name}`} type="number" min="0" step="0.1" value={layer.thicknessMm} onChange={(event) => updateLayer(layer.id, { thicknessMm: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Lambda ${layer.name}`} type="number" min="0.001" step="0.001" value={layer.lambda} onChange={(event) => updateLayer(layer.id, { lambda: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Mí ${layer.name}`} type="number" min="0" step="1" value={layer.mu} onChange={(event) => updateLayer(layer.id, { mu: Number(event.target.value) })} /></td>
                    <td><input aria-label={`Vlastní R ${layer.name}`} type="number" min="0" step="0.01" placeholder="auto" value={layer.fixedR ?? ""} onChange={(event) => updateLayer(layer.id, { fixedR: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                    <td><input aria-label={`Vlastní sd ${layer.name}`} type="number" min="0" step="0.01" placeholder="auto" value={layer.fixedSd ?? ""} onChange={(event) => updateLayer(layer.id, { fixedSd: event.target.value === "" ? null : Number(event.target.value) })} /></td>
                    <td><select className="wood-kind-select" aria-label={`Typ dřevěného prvku ${layer.name}`} value={woodKind} onChange={(event) => updateWoodKind(layer, event.target.value as "none" | "solid" | "osb")}><option value="none">Ne</option><option value="solid">Rostlé dřevo</option><option value="osb">OSB / deska</option></select></td>
                    <td><div className="wood-property-inputs"><label title="Objemová hmotnost"><input aria-label={`Objemová hmotnost ${layer.name}`} type="number" min="100" max="1200" step="10" disabled={woodKind === "none"} value={woodKind === "none" ? "" : densityKgM3} onChange={(event) => updateLayer(layer.id, { densityKgM3: Number(event.target.value) })} /><span>kg/m³</span></label><label title="Počáteční vlhkost"><input aria-label={`Počáteční vlhkost ${layer.name}`} type="number" min="0" max="100" step="0.5" disabled={woodKind === "none"} value={woodKind === "none" ? "" : initialMoisturePercent} onChange={(event) => updateLayer(layer.id, { initialMoisturePercent: Number(event.target.value) })} /><span>%</span></label></div></td>
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
        <div className="term-legend" aria-label="Vysvětlivky k vlastnostem vrstev">
          <strong>Vysvětlivky:</strong><span><b>d</b> tloušťka</span><span><b>λ</b> tepelná vodivost</span><span><b>μ</b> difuzní faktor</span><span><b>R</b> tepelný odpor</span><span><b>sd</b> difuzní odpor vyjádřený ekvivalentní tloušťkou vzduchu</span><span><b>ρ</b> objemová hmotnost dřeva</span><span><b>u₀</b> počáteční hmotnostní vlhkost</span>
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
        <article><span><HelpTerm label="Součinitel prostupu U" help="Množství tepla procházející 1 m² konstrukce při rozdílu teplot 1 K. Nižší hodnota znamená lepší tepelnou izolaci." align="left" /></span><strong>{preciseFormat.format(activeResult.uValue)}</strong><small>W/(m²K)</small></article>
        <article><span><HelpTerm label="Celkový tepelný odpor" help="Součet tepelných odporů aktivních vrstev a obou povrchových odporů. Vyšší hodnota znamená lepší tepelnou izolaci." align="left" /></span><strong>{format(activeResult.totalThermal, 2)}</strong><small>m²K/W</small></article>
        <article><span><HelpTerm label="Tepelný tok" help="Vypočtený tepelný výkon procházející 1 m² konstrukce při právě zadaném rozdílu vnitřní a venkovní teploty." align="left" /></span><strong>{format(Math.abs(activeResult.heatFlux), 2)}</strong><small>W/m²</small></article>
        <article className={activeResult.status === "risk" ? "danger-metric" : "safe-metric"}><span><HelpTerm label="Max. relativní vlhkost" help="Relativní vlhkost je fyzikálně omezena na 100 %. Případné překročení původního lineárního tlakového profilu se zobrazuje zvlášť jako kondenzační potenciál." align="right" /></span><strong>{format(Math.min(100, activeResult.maxSaturation), 0)}</strong><small>% RH</small>{activeResult.maxSaturation >= 100 && <em>Kondenzační potenciál {format(activeResult.maxSaturation / 100, 2)}×</em>}</article>
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
          {activeResult.firstRisk && <dl><div><dt>Začátek kritického úseku</dt><dd>{activeResult.firstRisk.locationLabel}</dd></div><div><dt>Poloha od interiéru</dt><dd>{format(activeResult.firstRisk.positionMm, 0)} mm</dd></div><div><dt>Maximum potenciálu</dt><dd>{activeResult.peakRisk?.locationLabel ?? activeResult.firstRisk.locationLabel}</dd></div><div><dt>Poměr p / p<sub>sat</sub></dt><dd>{format((activeResult.peakRisk?.condensationRatio ?? activeResult.firstRisk.condensationRatio), 2)}×</dd></div></dl>}
          {activePeakLayer?.note && <p className="material-model-note"><strong>Poznámka k modelu:</strong> {activePeakLayer.note}</p>}
          <p className="fine-print">Relativní vlhkost se nezobrazuje nad 100 %. Kondenzační potenciál nad 1,00× je teoretické překročení tlaku nasycené páry v suchém lineárním profilu, nikoli skutečná relativní vlhkost. Množství a vysychání hodnotí měsíční bilance níže.</p>
        </aside>
      </section>

      <section className="interfaces-panel">
        <div className="section-heading">
          <div><span className="step">05</span><h2>Výsledky na rozhraní vrstev</h2></div>
          <button className="outline-button" type="button" onClick={exportCsv}>Stáhnout CSV</button>
        </div>
        <div className="layer-table-wrap">
          <table className="result-table">
            <thead><tr><th>Místo</th><th><HelpTerm label="Poloha" help="Vzdálenost daného rozhraní od vnitřního povrchu skladby." /></th><th>Teplota</th><th><HelpTerm label="Rosný bod" help="Teplota, při které by vodní pára při vypočteném parciálním tlaku dosáhla nasycení." /></th><th><HelpTerm label="Rel. vlhkost" help="Fyzikálně omezená relativní vlhkost. Při kondenzaci se zobrazuje nejvýše 100 %." /></th><th><HelpTerm label="Kondenzační poměr" help="Teoretický poměr parciálního tlaku p k tlaku nasycené páry psat před omezením kondenzací. Hodnota nad 1,00× označuje kondenzační potenciál, nikoli skutečnou relativní vlhkost." /></th><th>Hodnocení</th></tr></thead>
            <tbody>{activeResult.interfaces.map((point, index) => (
              <tr key={`${point.label}-${index}`}>
                <td>{point.label}</td><td>{format(point.positionMm, 1)} mm</td><td>{format(point.temperature, 2)} °C</td><td>{format(point.dewPoint, 2)} °C</td><td>{format(point.relativeHumidity, 1)} %</td><td>{point.condensationRatio > 1 ? `${format(point.condensationRatio, 2)}×` : "—"}</td>
                <td><span className={`result-badge ${point.saturationRatio >= 100 ? "risk" : point.saturationRatio >= 95 ? "warning" : "safe"}`}>{point.saturationRatio >= 100 ? "Kondenzace" : point.saturationRatio >= 95 ? "Na hraně" : "Bez průsečíku"}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="term-legend" aria-label="Vysvětlivky k výsledkům na rozhraních">
          <strong>Čtení tabulky:</strong><span>Poloha se měří od interiéru.</span><span>Relativní vlhkost končí na 100 %; další teoretický přebytek vyjadřuje kondenzační poměr nad 1,00×.</span>
        </div>
      </section>

      <section className="monthly-panel">
        <div className="section-heading monthly-heading">
          <div><span className="step">06</span><div><h2>Měsíční bilance kondenzace a vysychání</h2><p>Aktivní varianta „{activeVariant.name}“ · výchozí venkovní klima Brno</p></div></div>
          <div className="monthly-actions">
            <button className="text-button" type="button" onClick={() => setMonthlyClimate(cloneDefaultMonthlyClimate())}>Výchozí Brno</button>
            <button className="outline-button" type="button" onClick={applyIndoorConditionsToYear}>Vnitřní podle 01</button>
            <button className="outline-button" type="button" onClick={exportMonthlyCsv} disabled={!monthlyResult.hasCalculation}>Stáhnout CSV</button>
          </div>
        </div>

        {monthlyResult.hasCalculation ? (
          <>
            <div className={`monthly-callout ${monthlyResult.status}`}>
              <div><span className="summary-label">Roční vyhodnocení</span><strong>{monthlyStatusCopy.label}</strong><p>{monthlyStatusCopy.detail}</p></div>
              <dl>
                <div><dt>Rozhodující místo</dt><dd>{monthlyResult.governingPlane?.label ?? "Žádné kondenzační místo"}</dd></div>
                <div><dt>Poloha od interiéru</dt><dd>{monthlyResult.governingPlane ? `${format(monthlyResult.governingPlane.positionMm, 0)} mm` : "—"}</dd></div>
              </dl>
            </div>

            <div className="monthly-metrics">
              <article><span><HelpTerm label="Vznik kondenzátu" help="Součet nově vzniklého kondenzátu ve všech vypočtených místech skladby za celý roční cyklus." align="left" /></span><strong>{format(monthlyResult.annualCondensationGm2, 1)}</strong><small>g/m² za cyklus</small></article>
              <article><span><HelpTerm label="Odpaření" help="Součet skutečně odpařeného dříve nahromaděného kondenzátu ze všech míst skladby." align="left" /></span><strong>{format(monthlyResult.annualEvaporationGm2, 1)}</strong><small>g/m² za cyklus</small></article>
              <article><span><HelpTerm label="Maximum ve skladbě" help="Nejvyšší celkové množství kondenzátu současně uložené ve všech místech skladby během ročního cyklu." align="left" /></span><strong>{format(monthlyResult.peakStoredGm2, 1)}</strong><small>g/m²</small></article>
              <article className={monthlyResult.status === "risk" ? "danger-metric" : "safe-metric"}><span><HelpTerm label="Roční přírůstek" help="Množství vlhkosti, které po započtení vysychání přibude za jeden celý rok. Kladná hodnota znamená hromadění mezi roky." align="right" /></span><strong>{format(Math.max(0, monthlyResult.annualPotentialGm2), 1)}</strong><small>g/m² za rok</small></article>
            </div>

            <div className="monthly-locations">
              <div className="monthly-locations-copy">
                <h3>Místa kondenzace a vysychání</h3>
                <p>Výpočet rozlišuje jednotlivé oblasti a řeší jejich vzájemný vliv na tok vodní páry. Kliknutím vyberete detail.</p>
              </div>
              <div className="layer-table-wrap">
                <table className="result-table location-table">
                  <thead><tr><th>Místo</th><th><HelpTerm label="Poloha" help="Bod nebo rozsah, ve kterém model zachytil kondenzaci, měřený od interiéru." /></th><th><HelpTerm label="Vznik" help="Kondenzát vzniklý v tomto místě za roční cyklus." /></th><th><HelpTerm label="Odpaření" help="Kondenzát odpařený z tohoto místa za roční cyklus." /></th><th><HelpTerm label="Maximum" help="Nejvyšší množství vlhkosti uložené v tomto místě." /></th><th><HelpTerm label="Roční změna" help="Rozdíl uložené vlhkosti na konci a začátku ročního cyklu." /></th><th>Výsledek</th></tr></thead>
                  <tbody>{monthlyResult.locations.length > 0 ? monthlyResult.locations.map((location) => (
                    <tr key={location.id} className={monthlyView.id === location.id ? "selected-location" : ""}>
                      <td><button type="button" className="location-select-button" onClick={() => setMonthlyViewId(location.id)}>{location.label}</button></td>
                      <td>{Math.abs(location.positionEndMm - location.positionStartMm) > 0.1 ? `${format(location.positionStartMm, 0)}–${format(location.positionEndMm, 0)} mm` : `${format(location.positionMm, 0)} mm`}</td>
                      <td className="condensation-value">{format(location.annualCondensationGm2, 2)} g/m²</td>
                      <td className="evaporation-value">{format(location.annualEvaporationGm2, 2)} g/m²</td>
                      <td>{format(location.peakStoredGm2, 2)} g/m²</td>
                      <td>{format(location.annualChangeGm2, 2)} g/m²</td>
                      <td><span className={`result-badge ${location.status}`}>{location.status === "risk" ? "Narůstá" : location.fullyDries ? "Vyschne v cyklu" : "Bilance vyrovnaná"}</span></td>
                    </tr>
                  )) : (
                    <tr><td colSpan={7} className="no-location">Měsíční model v této skladbě nenašel kondenzaci.</td></tr>
                  )}</tbody>
                </table>
              </div>
            </div>

            <div className="monthly-chart-panel">
              <div className="monthly-chart-copy">
                <div><h3>Průběh během roku · {monthlyView.label}</h3><p>Sloupce ukazují měsíční kondenzaci a skutečně využité odpaření, tmavá křivka množství zadržené na konci měsíce.</p></div>
                <div className="legend"><span className="condensation-bar">Kondenzace</span><span className="evaporation-bar">Odpaření</span><span className="stored-line">Nahromaděno</span></div>
              </div>
              <div className="monthly-view-tabs" role="tablist" aria-label="Zobrazené místo měsíční bilance">
                {monthlyViews.map((view) => <button key={view.id} type="button" role="tab" aria-selected={monthlyView.id === view.id} className={monthlyView.id === view.id ? "active" : ""} onClick={() => setMonthlyViewId(view.id)}>{view.label}</button>)}
              </div>
              <MonthlyBalanceChart result={monthlyView} />
            </div>

            <div className="layer-table-wrap">
              <table className="result-table monthly-table">
                <thead><tr><th>Měsíc</th><th><HelpTerm label="Ti [°C]" help="Průměrná vnitřní teplota v daném měsíci." /></th><th><HelpTerm label="RHi [%]" help="Průměrná relativní vlhkost vnitřního vzduchu v daném měsíci." /></th><th><HelpTerm label="Te [°C]" help="Průměrná venkovní teplota v daném měsíci." /></th><th><HelpTerm label="RHe [%]" help="Průměrná relativní vlhkost venkovního vzduchu v daném měsíci." /></th><th><HelpTerm label="Kondenzace" help="Množství nově vzniklého kondenzátu v daném měsíci ve zvoleném pohledu." /></th><th><HelpTerm label="Odpaření" help="Množství dříve nahromaděného kondenzátu, které se ve zvoleném pohledu v daném měsíci odpaří." /></th><th><HelpTerm label="Nahromaděno" help="Množství kondenzátu, které ve zvoleném pohledu zůstává na konci daného měsíce." align="right" /></th></tr></thead>
                <tbody>{monthlyView.months.map((month) => (
                  <tr key={month.id} className={month.storedGm2 > 0.001 ? "wet-month" : ""}>
                    <td>{month.month}</td>
                    <td><input className="climate-input" aria-label={`Vnitřní teplota ${month.month}`} type="number" step="0.1" min="-30" max="50" value={month.insideTemperature} onChange={(event) => updateMonthlyClimate(month.id, "insideTemperature", Number(event.target.value))} /></td>
                    <td><input className="climate-input" aria-label={`Vnitřní vlhkost ${month.month}`} type="number" step="0.1" min="0" max="100" value={month.insideHumidity} onChange={(event) => updateMonthlyClimate(month.id, "insideHumidity", Number(event.target.value))} /></td>
                    <td><input className="climate-input" aria-label={`Venkovní teplota ${month.month}`} type="number" step="0.1" min="-50" max="50" value={month.outsideTemperature} onChange={(event) => updateMonthlyClimate(month.id, "outsideTemperature", Number(event.target.value))} /></td>
                    <td><input className="climate-input" aria-label={`Venkovní vlhkost ${month.month}`} type="number" step="0.1" min="0" max="100" value={month.outsideHumidity} onChange={(event) => updateMonthlyClimate(month.id, "outsideHumidity", Number(event.target.value))} /></td>
                    <td className="condensation-value">{format(month.condensationGm2, 2)} g/m²</td>
                    <td className="evaporation-value">{format(month.evaporationGm2, 2)} g/m²</td>
                    <td><strong>{format(month.storedGm2, 2)} g/m²</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="term-legend" aria-label="Vysvětlivky k měsíčním klimatickým údajům">
              <strong>Klimatické zkratky:</strong><span><b>Ti</b> vnitřní teplota</span><span><b>RHi</b> vnitřní relativní vlhkost</span><span><b>Te</b> venkovní teplota</span><span><b>RHe</b> venkovní relativní vlhkost</span>
            </div>
          </>
        ) : (
          <p className="monthly-empty">Pro měsíční bilanci jsou potřeba alespoň dvě aktivní vrstvy s nenulovým difuzním odporem.</p>
        )}

        <div className="monthly-note">
          <p><strong>Jak číst výsledek:</strong> všechna nasycená místa se v každém měsíci řeší současně a společně mění tlakový profil. Vlhkost se vede odděleně pro každé místo do dalších měsíců; kladný roční přírůstek znamená hromadění mezi roky.</p>
          <p><strong>Zdroj výchozího klimatu:</strong> NASA POWER, měsíční klimatologie 2001–2020 pro Brno (49,195° N; 16,607° E). Vnitřní podmínky jsou uživatelský předpoklad, nikoli klimatická data.</p>
        </div>
      </section>

      <section className="wood-panel">
        <div className="section-heading wood-heading">
          <div><span className="step">07</span><div><h2>Riziko pro dřevěné prvky</h2><p>Rovnovážná vlhkost, doba expozice a kontakt s kondenzátem · varianta „{activeVariant.name}“</p></div></div>
          <div className="wood-actions">
            <label>Vzduchotěsnost teplé strany
              <select value={woodSettings.airTightness} onChange={(event) => setWoodSettings({ airTightness: event.target.value as AirTightness })}>
                <option value="continuous">Souvislá a ověřená</option>
                <option value="uncertain">Nejistá</option>
                <option value="leaky">Netěsná – vaše zadání</option>
              </select>
            </label>
            <button className="outline-button" type="button" onClick={exportWoodCsv} disabled={woodAssessment.elements.length === 0}>Stáhnout CSV</button>
          </div>
        </div>

        {woodAssessment.elements.length > 0 ? (
          <>
            <div className={`wood-callout ${woodAssessment.status}`}>
              <div><span className="summary-label">Screening dřeva</span><strong>{woodStatusCopy.label}</strong><p>{woodStatusCopy.detail}</p></div>
              <dl>
                <div><dt>Rozhodující prvek</dt><dd>{woodAssessment.governingElement?.label ?? "—"}</dd></div>
                <div><dt>Maximum u<sub>eq</sub></dt><dd>{format(woodAssessment.governingElement?.peakEquilibriumMoisturePercent ?? 0, 1)} %</dd></div>
              </dl>
            </div>

            <div className="wood-metrics">
              <article><span><HelpTerm label="Maximum ueq" help="Nejvyšší rovnovážná hmotnostní vlhkost vypočtená z měsíční teploty a relativní vlhkosti v rozhodujícím prvku. Není to měření ani okamžitá vlhkost celého průřezu." align="left" /></span><strong>{format(woodAssessment.governingElement?.peakEquilibriumMoisturePercent ?? 0, 1)}</strong><small>% hmotnosti</small></article>
              <article><span><HelpTerm label="Dny nad 16 %" help="Součet dnů v měsících, jejichž průměrné podmínky odpovídají rovnovážné vlhkosti alespoň 16 %. Jde o měsíční screening, nikoli hodinový údaj." align="left" /></span><strong>{format(woodAssessment.governingElement?.daysAbove16Percent ?? 0, 0)}</strong><small>dnů za rok</small></article>
              <article><span><HelpTerm label="Dny nad 20 %" help="Součet dnů v měsících s rovnovážnou vlhkostí alespoň 20 %. Delší teplé a vlhké období zvyšuje riziko biologického napadení." align="left" /></span><strong>{format(woodAssessment.governingElement?.daysAbove20Percent ?? 0, 0)}</strong><small>dnů za rok</small></article>
              <article className={woodAssessment.governingElement?.annualChangeGm2 > 0.001 ? "danger-metric" : "safe-metric"}><span><HelpTerm label="Kondenzát v kontaktu" help="Kondenzát vzniklý přímo uvnitř dřevěné vrstvy nebo na některém z jejích rozhraní. Není automaticky převeden na vlhkost celého průřezu." align="right" /></span><strong>{format(woodAssessment.governingElement?.annualCondensationGm2 ?? 0, 1)}</strong><small>g/m² za cyklus</small></article>
            </div>

            <div className="layer-table-wrap">
              <table className="result-table wood-result-table">
                <thead><tr><th>Prvek</th><th><HelpTerm label="Typ / vstup" help="Druh prvku, objemová hmotnost ρ a počáteční vlhkost u₀ nastavené v tabulce vrstev." /></th><th><HelpTerm label="Max. ueq" help="Maximum rovnovážné vlhkosti ve vypočteném ročním cyklu." /></th><th><HelpTerm label="≥ 16 %" help="Počet dnů podle měsíčních průměrů nad orientační zvýšenou mezí 16 %." /></th><th><HelpTerm label="≥ 20 %" help="Počet dnů podle měsíčních průměrů nad praktickou rizikovou mezí 20 %." /></th><th><HelpTerm label="Kondenzát" help="Roční vznik kondenzátu v kontaktu s prvkem. Doplňkový přepočet ukazuje jen ekvivalent při nereálném rovnoměrném rozdělení maxima do celé tloušťky prvku." /></th><th><HelpTerm label="Roční změna" help="Meziroční změna zásoby kapalného kondenzátu v kontaktu s prvkem." /></th><th>Výsledek</th></tr></thead>
                <tbody>{woodAssessment.elements.map((element) => (
                  <tr key={element.id} className={woodView?.id === element.id ? "selected-location" : ""}>
                    <td><button type="button" className="location-select-button" onClick={() => setWoodViewId(element.id)}>{element.label}</button></td>
                    <td><span className="wood-type-copy">{element.woodKindLabel}<small>ρ {format(element.densityKgM3, 0)} kg/m³ · u₀ {format(element.initialMoisturePercent, 1)} %</small></span></td>
                    <td><strong>{format(element.peakEquilibriumMoisturePercent, 1)} %</strong></td>
                    <td>{format(element.daysAbove16Percent, 0)} dnů</td>
                    <td>{format(element.daysAbove20Percent, 0)} dnů</td>
                    <td className="condensation-value"><span className="wood-type-copy">{format(element.annualCondensationGm2, 2)} g/m²<small>ekv. max. {format(element.liquidEquivalentPercent, 3)} %</small></span></td>
                    <td>{format(element.annualChangeGm2, 2)} g/m²</td>
                    <td><span className={`result-badge ${element.status}`}>{element.status === "risk" ? "Vysoké" : element.status === "warning" ? "Zvýšené" : "Nízké"}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            {woodView && <div className="wood-detail">
              <div className="monthly-chart-copy">
                <div><h3>Průběh vlhkostního indikátoru · {woodView.label}</h3><p>Tabulka ukazuje vždy nejnepříznivější bod daného prvku v každém měsíci.</p></div>
              </div>
              <div className="monthly-view-tabs" role="tablist" aria-label="Zobrazený dřevěný prvek">
                {woodAssessment.elements.map((element) => <button key={element.id} type="button" role="tab" aria-selected={woodView.id === element.id} className={woodView.id === element.id ? "active" : ""} onClick={() => setWoodViewId(element.id)}>{element.label}</button>)}
              </div>
              <div className="layer-table-wrap">
                <table className="result-table wood-monthly-table">
                  <thead><tr><th>Měsíc</th><th><HelpTerm label="T [°C]" help="Teplota v nejnepříznivějším hodnoceném bodě prvku." /></th><th><HelpTerm label="RH [%]" help="Relativní vlhkost v nejnepříznivějším bodě po započtení současných kondenzačních míst." /></th><th><HelpTerm label="ueq [%]" help="Rovnovážná hmotnostní vlhkost dřeva odpovídající vypočtené teplotě a RH." /></th><th><HelpTerm label="Poloha" help="Vzdálenost nejnepříznivějšího bodu od interiéru." /></th><th><HelpTerm label="Kondenzace" help="Kondenzát vzniklý v daném měsíci v kontaktu s prvkem." /></th><th><HelpTerm label="Uloženo" help="Kapalný kondenzát, který na konci měsíce zůstává v kontaktu s prvkem." /></th><th>Hodnocení</th></tr></thead>
                  <tbody>{woodView.months.map((month) => (
                    <tr key={month.id} className={month.status === "risk" ? "wet-month" : ""}>
                      <td>{month.month}</td><td>{format(month.temperature, 1)} °C</td><td>{format(month.relativeHumidity, 1)} %</td><td><strong>{format(month.equilibriumMoisturePercent, 1)} %</strong></td><td>{format(month.worstPositionMm, 0)} mm</td><td className="condensation-value">{format(month.condensationGm2, 2)} g/m²</td><td>{format(month.storedGm2, 2)} g/m²</td><td><span className={`result-badge ${month.status}`}>{month.status === "risk" ? "≥ 20 %" : month.status === "warning" ? "Zvýšené" : "Nízké"}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>}
          </>
        ) : (
          <p className="monthly-empty">Ve vrstvách není označen žádný dřevěný prvek. Typ můžete nastavit ve sloupci „Dřevěný prvek“.</p>
        )}

        <div className="wood-note">
          <p><strong>Význam u<sub>eq</sub>:</strong> rovnovážná vlhkost vyjadřuje, k jaké vlhkosti by dřevo při daném měsíčním klimatu směřovalo. Neříká, že jí celý průřez během jednoho měsíce skutečně dosáhne. Pro OSB je vztah pouze orientační náhradou bez produktové sorpční křivky.</p>
          <p className={woodAssessment.airLeakageWarning ? "air-warning" : ""}><strong>Proudění vzduchu:</strong> volba vzduchotěsnosti nemění číselný difuzní výpočet. U netěsné nebo neznámé teplé strany přidává kvalitativní varování, protože množství vlhkosti proudící netěsnostmi bez měření nelze věrohodně určit.</p>
        </div>
      </section>

      <section className="method-panel">
        <h2>Co tento výpočet znamená</h2>
        <div className="method-columns">
          <p><strong>Umí:</strong> jednorozměrný profil teploty a vodní páry, rosný bod, U, propojenou měsíční bilanci ve více místech a konzervativní screening vlhkostního rizika označených dřevěných prvků.</p>
          <p><strong>Neumí:</strong> déšť, sluneční a dlouhovlnné záření, zabudovanou vlhkost, kapilární transport, proudění netěsnostmi ani přesné 2D křížení trámů.</p>
          <p><strong>Použití:</strong> vhodné pro porovnání variant a odhalení problémových skladeb. Pro realizační projekt ověřte kritickou skladbu dynamickým hygrotermickým výpočtem.</p>
        </div>
      </section>

      <footer><span>Střešní fyzika</span><span>Výpočet pracuje pouze s údaji uloženými ve vašem prohlížeči.</span></footer>
    </main>
  );
}
