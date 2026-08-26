export type Layer = {
  id: string;
  name: string;
  thicknessMm: number;
  lambda: number;
  mu: number;
  fixedR: number | null;
  fixedSd: number | null;
  enabled: boolean;
  color: string;
  note?: string;
  woodKind?: "none" | "solid" | "osb";
  densityKgM3?: number;
  initialMoisturePercent?: number;
};

export type Conditions = {
  insideTemperature: number;
  insideHumidity: number;
  outsideTemperature: number;
  outsideHumidity: number;
};

export type Variant = {
  id: string;
  name: string;
  description: string;
  layers: Layer[];
};

export type MonthlyClimate = Conditions & {
  id: string;
  month: string;
  days: number;
};

const colors = {
  plaster: "#d8c8a9",
  wood: "#b77b46",
  wool: "#e4bf56",
  air: "#dbe9e7",
  osb: "#a96f3d",
  asphalt: "#343b3b",
  pir: "#d7b8df",
  membrane: "#718a9e",
  gypsum: "#e8e4dd",
  vapour: "#d46f42",
};

function layer(id: string, name: string, thicknessMm: number, lambda: number, mu: number, color: string, overrides: Partial<Layer> = {}): Layer {
  return { id, name, thicknessMm, lambda, mu, fixedR: null, fixedSd: null, enabled: true, color, ...overrides };
}

const exteriorLayers = (prefix: string): Layer[] => [
  layer(`${prefix}-osb`, "OSB/3 Kronospan", 25, 0.1, 100, colors.osb, {
    note: "μ pro vlhký stav; výpočet vlhkosti OSB používá orientační náhradní sorpční vztah pro dřevo",
    woodKind: "osb",
    densityKgM3: 600,
    initialMoisturePercent: 10,
  }),
  layer(`${prefix}-glastek`, "GLASTEK 40 STICKER PLUS", 4, 0.17, 27000, colors.asphalt, { fixedSd: 108 }),
  layer(`${prefix}-pir`, "PIR deska", 160, 0.022, 260, colors.pir, {
    note: "R se automaticky počítá jako d / λ a sd jako d × μ. Efektivní μ je orientační vstup a lze jej upravit podle konkrétního výrobku; poloha uvnitř kompozitní desky je pouze orientační.",
  }),
  layer(`${prefix}-pvc`, "Sikaplan G-18", 1.8, 0.16, 20000, colors.membrane, { fixedSd: 36 }),
];

const interiorLayers = (prefix: string): Layer[] => [
  layer(`${prefix}-plaster`, "Vápenocementová omítka", 20, 0.87, 10, colors.plaster),
  layer(`${prefix}-boarding`, "Smrkové bednění", 20, 0.13, 20, colors.wood, {
    woodKind: "solid",
    densityKgM3: 450,
    initialMoisturePercent: 12,
  }),
];

export const presetDefinitions = {
  woolField: {
    label: "S vatou – běžné pole",
    description: "180 mm vaty a uzavřená dutina k OSB",
    make: (prefix = "wf") => [
      ...interiorLayers(prefix),
      layer(`${prefix}-wool`, "DEKwool G 035r", 180, 0.035, 1, colors.wool),
      layer(`${prefix}-air`, "Uzavřená vzduchová dutina", 220, 0.15, 1, colors.air, { fixedR: 0.16, fixedSd: 0.22, note: "R se nezvyšuje lineárně s tloušťkou" }),
      ...exteriorLayers(prefix),
    ],
  },
  woolWorst: {
    label: "S vatou – pod vysokým spádovým trámem",
    description: "Nejnepříznivější jednorozměrný řez",
    make: (prefix = "ww") => [
      ...interiorLayers(prefix),
      layer(`${prefix}-wool`, "DEKwool G 035r", 180, 0.035, 1, colors.wool),
      layer(`${prefix}-air`, "Uzavřená vzduchová mezera", 20, 0.15, 1, colors.air, { fixedR: 0.16, fixedSd: 0.02 }),
      layer(`${prefix}-slope`, "Spádový trám – maximum", 200, 0.13, 20, colors.wood, {
        woodKind: "solid",
        densityKgM3: 450,
        initialMoisturePercent: 12,
      }),
      ...exteriorLayers(prefix),
    ],
  },
  noWoolField: {
    label: "Bez vaty – běžné pole",
    description: "Uzavřená dutina mezi bedněním a OSB",
    make: (prefix = "nf") => [
      ...interiorLayers(prefix),
      layer(`${prefix}-air`, "Uzavřená vzduchová dutina", 400, 0.15, 1, colors.air, { fixedR: 0.16, fixedSd: 0.4 }),
      ...exteriorLayers(prefix),
    ],
  },
  noWoolWorst: {
    label: "Bez vaty – křížení trámů",
    description: "Lokální kritické místo v nejvyšším bodě",
    make: (prefix = "nw") => [
      ...interiorLayers(prefix),
      layer(`${prefix}-main`, "Hlavní trám", 200, 0.13, 20, colors.wood, {
        woodKind: "solid",
        densityKgM3: 450,
        initialMoisturePercent: 12,
      }),
      layer(`${prefix}-slope`, "Spádový trám – maximum", 200, 0.13, 20, colors.wood, {
        woodKind: "solid",
        densityKgM3: 450,
        initialMoisturePercent: 12,
      }),
      ...exteriorLayers(prefix),
    ],
  },
};

export type PresetKey = keyof typeof presetDefinitions;

export const defaultConditions: Conditions = {
  insideTemperature: 21,
  insideHumidity: 50,
  outsideTemperature: -15,
  outsideHumidity: 84,
};

const brnoClimate = [
  ["jan", "Leden", 31, -2.56, 91.77],
  ["feb", "Únor", 28, -0.59, 87.74],
  ["mar", "Březen", 31, 3.9, 80.33],
  ["apr", "Duben", 30, 9.79, 73.43],
  ["may", "Květen", 31, 14.74, 70.78],
  ["jun", "Červen", 30, 19.19, 66.13],
  ["jul", "Červenec", 31, 21.45, 61.88],
  ["aug", "Srpen", 31, 20.94, 62.41],
  ["sep", "Září", 30, 15.38, 69.64],
  ["oct", "Říjen", 31, 9.35, 80.91],
  ["nov", "Listopad", 30, 4.25, 88.98],
  ["dec", "Prosinec", 31, -1.12, 92.33],
] as const;

export const defaultMonthlyClimate: MonthlyClimate[] = brnoClimate.map(([
  id,
  month,
  days,
  outsideTemperature,
  outsideHumidity,
]) => ({
  id,
  month,
  days,
  insideTemperature: 21,
  insideHumidity: 50,
  outsideTemperature,
  outsideHumidity,
}));

export const defaultVariants: Variant[] = [
  {
    id: "with-wool",
    name: "S vatou",
    description: presetDefinitions.woolField.description,
    layers: presetDefinitions.woolField.make("a"),
  },
  {
    id: "without-wool",
    name: "Bez vaty",
    description: presetDefinitions.noWoolField.description,
    layers: presetDefinitions.noWoolField.make("b"),
  },
];

export const materialLibrary: Omit<Layer, "id">[] = [
  layer("", "Sádrokarton", 12.5, 0.25, 10, colors.gypsum),
  layer("", "Vápenocementová omítka", 20, 0.87, 10, colors.plaster),
  layer("", "Jehličnaté dřevo", 20, 0.13, 20, colors.wood, { woodKind: "solid", densityKgM3: 450, initialMoisturePercent: 12 }),
  layer("", "Minerální vata", 180, 0.035, 1, colors.wool),
  layer("", "Uzavřená vzduchová vrstva", 20, 0.15, 1, colors.air, { fixedR: 0.16, fixedSd: 0.02 }),
  layer("", "OSB/3", 25, 0.1, 100, colors.osb, { woodKind: "osb", densityKgM3: 600, initialMoisturePercent: 10 }),
  layer("", "Asfaltový pás", 4, 0.17, 27000, colors.asphalt),
  layer("", "PIR deska", 160, 0.022, 260, colors.pir, { note: "R a sd se automaticky přepočítávají z tloušťky; efektivní μ upravte podle konkrétního výrobku." }),
  layer("", "PVC-P střešní fólie", 1.8, 0.16, 20000, colors.membrane),
  layer("", "PE parozábrana", 0.2, 0.33, 500000, colors.vapour, { fixedSd: 100 }),
  layer("", "Vlastní materiál", 100, 0.1, 10, "#9aa7a3"),
];
