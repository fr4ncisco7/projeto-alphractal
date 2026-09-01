export type User = {
  id: string;
  name: string;
  email: string;
  plan: string;
};

export type Credentials = {
  identifier: string;
  password: string;
};

export type LoginResponse = {
  token: string;
  user: User;
};

export type Metric = {
  id: string;
  label: string;
  value: string;
  change: number;
  hint: string;
};

export type Overview = {
  updatedAt: string;
  metrics: Metric[];
};

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  score: number;
  trend: "up" | "down" | "flat";
};

export type AnalysisAssets = {
  assets: Asset[];
};

export type Prediction = {
  id: string;
  asset: string;
  horizon: string;
  direction: "up" | "down";
  confidence: number;
};

export type Predictions = {
  generatedAt: string;
  items: Prediction[];
};
