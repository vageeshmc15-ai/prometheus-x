import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('Gemini API key is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const GEMINI_PRIMARY_MODEL = 'gemini-4-hydrogen';
const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function formatGeminiError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    const msg = parsed?.error?.message;
    if (typeof msg === 'string' && msg.trim()) {
      return new Error(msg.trim());
    }
  } catch {
    // Raw message is not JSON
  }
  return err instanceof Error ? err : new Error(raw || 'Upstream Gemini service error.');
}

async function callGeminiWithRetry(
  fn: (model: string) => Promise<GenerateContentResponse>
): Promise<GenerateContentResponse> {
  const modelsToTry = [GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL];
  let lastError: unknown;

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await fn(model);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const isTransient =
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand') ||
          msg.includes('429') ||
          msg.includes('ECONNRESET');
        if (!isTransient) {
          throw formatGeminiError(err);
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
    }
  }

  throw formatGeminiError(lastError);
}

export async function generateDefectExplanation(input: {
  passportCode: string;
  factoryName: string;
  sector: string;
  lineName: string;
  defectType: string;
  severity: string;
  cvConfidence: number;
  anomalyScore: number;
  reliabilityScore: number;
  reliabilityStatus: string;
  cvMetrics: {
    edgeDensity: number;
    contrastVariance: number;
    anomalyEnergy: number;
  };
  perturbationSummary: string;
}): Promise<string> {
  const ai = getGeminiClient();
  const prompt = `You are a Principal Manufacturing Reliability & Quality Assurance Engineer for PROMETHEUS-X.
Generate a concise, structured technical root-cause investigation and corrective action brief (max 220 words) for the following computer-vision inspection finding. Do not use markdown code blocks or filler greetings.

Inspection Record:
- Digital Defect Passport: ${input.passportCode}
- Facility & Sector: ${input.factoryName} (${input.sector})
- Production Line: ${input.lineName}
- CV-Detected Defect: ${input.defectType} (Severity: ${input.severity})
- CV Confidence: ${(input.cvConfidence * 100).toFixed(1)}% | Anomaly Score: ${input.anomalyScore.toFixed(3)}
- CV Feature Telemetry: Edge Density ${input.cvMetrics.edgeDensity.toFixed(3)}, Contrast Variance ${input.cvMetrics.contrastVariance.toFixed(2)}, Anomaly Energy ${input.cvMetrics.anomalyEnergy.toFixed(3)}
- Self-Challenging AI Reliability: ${input.reliabilityScore.toFixed(1)}% (${input.reliabilityStatus})
- Perturbation Stress Profile: ${input.perturbationSummary}

Format strictly into three labeled paragraphs:
1. Root-Cause Engineering Diagnosis
2. Model Reliability Assessment
3. Immediate Containment & Preventive Action`;

  const response = await callGeminiWithRetry((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'You provide crisp, authoritative industrial manufacturing quality and reliability analysis based strictly on computer vision telemetry. Never invent sensor readings not provided.',
      },
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty investigation summary.');
  }
  return text;
}

export async function generateCounterfactualBrief(input: {
  factoryName: string;
  sector: string;
  targetDefect: string;
  baselineProb: number;
  predictedProb: number;
  riskDeltaPct: number;
  baselineParams: Record<string, number>;
  counterfactualParams: Record<string, number>;
  topDrivers: Array<{ parameter: string; contributionPct: number; direction: string }>;
}): Promise<string> {
  const ai = getGeminiClient();
  const driverText = input.topDrivers
    .map((d) => `${d.parameter}: ${d.contributionPct.toFixed(1)}% (${d.direction})`)
    .join('; ');

  const prompt = `You are a Principal Process Reliability Engineer analyzing a Counterfactual Factory Twin simulation in PROMETHEUS-X.
Write a crisp 180-word engineering investigation brief evaluating this simulated process intervention. Explicitly note that the simulation is a digital twin counterfactual estimate.

Simulation Context:
- Factory: ${input.factoryName} (${input.sector})
- Target Defect Mode: ${input.targetDefect}
- Baseline Defect Probability: ${(input.baselineProb * 100).toFixed(1)}%
- Counterfactual Defect Probability: ${(input.predictedProb * 100).toFixed(1)}%
- Net Risk Shift: ${input.riskDeltaPct > 0 ? '+' : ''}${input.riskDeltaPct.toFixed(1)} percentage points
- Baseline Parameters: ${JSON.stringify(input.baselineParams)}
- Counterfactual Parameters: ${JSON.stringify(input.counterfactualParams)}
- Top Causal Sensitivity Drivers: ${driverText}

Format into two concise sections:
1. Causal Mechanism Evaluation
2. Recommended Line Calibration Protocol`;

  const response = await callGeminiWithRetry((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction:
          'Provide practical, physics-grounded industrial engineering guidance for semiconductor, PCB, and automotive manufacturing lines.',
      },
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty counterfactual brief.');
  }
  return text;
}

export async function generateCrossFactoryDigest(input: {
  factorySummaries: Array<{
    name: string;
    sector: string;
    totalInspections: number;
    defectRatePct: number;
    avgReliability: number;
    topDefect: string;
  }>;
}): Promise<string> {
  const ai = getGeminiClient();
  const rows = input.factorySummaries
    .map(
      (f) =>
        `- ${f.name} (${f.sector}): ${f.totalInspections} inspections, ${f.defectRatePct.toFixed(1)}% defect rate, ${f.avgReliability.toFixed(1)}% avg AI reliability, leading defect: ${f.topDefect}`
    )
    .join('\n');

  const prompt = `You are the Director of Cross-Factory Quality Intelligence at PROMETHEUS-X.
Synthesize a concise 190-word Cross-Factory Reliability Digest across these three simulated plants:
${rows}

Highlight cross-plant risk transfer (especially shared electronics/automotive ECU process patterns), model reliability gaps requiring human-in-the-loop review, and top executive priorities for the next shift. Plain structured prose only.`;

  const response = await callGeminiWithRetry((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty cross-factory digest.');
  }
  return text;
}

export async function generateDashboardAssistantReply(input: {
  dashboardLabel: string;
  dashboardInventory: string;
  scopeLabel: string;
  userRole: string;
  telemetrySnapshot: string;
  mode: 'explain_dashboard' | 'chat';
  focusWidget?: string;
  message?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const ai = getGeminiClient();

  const historyText =
    input.history && input.history.length > 0
      ? input.history
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'User' : 'Advisor'}: ${m.content}`)
          .join('\n')
      : 'None (new conversation on this view).';

  const taskDirective =
    input.mode === 'explain_dashboard'
      ? input.focusWidget
        ? `Explain specifically the "${input.focusWidget}" element on the "${input.dashboardLabel}" dashboard in full detail using the live telemetry below, diagnose the exact root-cause solution for any risk or anomaly it reveals, and specify what concrete changes or actions should be made next.`
        : `Provide a complete, easy-to-follow breakdown of EVERYTHING currently visible on the "${input.dashboardLabel}" dashboard using the live telemetry below. Explain every chart, KPI, 3D visual, table, or control shown, provide the engineering solution to the active issues shown on this dashboard, and state clearly what changes or actions should be made next.`
      : `Answer the user's question directly and thoroughly using the live telemetry and UI elements of the "${input.dashboardLabel}" dashboard. Always connect your answer to (1) what the dashboard shows, (2) the technical solution, and (3) what concrete steps or changes should be made.
User Question: ${input.message || 'Explain this dashboard, its solutions, and what should be made.'}`;

  const prompt = `Active Dashboard: ${input.dashboardLabel}
Factory Scope: ${input.scopeLabel}
Operator Role: ${input.userRole}

UI Components Currently Visible on This Dashboard:
${input.dashboardInventory}

Live Database Telemetry Snapshot (Simulated Industrial Environment):
${input.telemetrySnapshot}

Recent Conversation:
${historyText}

Task:
${taskDirective}

Format your response cleanly using these three clear section headings (with plain bullet points starting with "- "):
### 1. Dashboard Details & What You Are Seeing
### 2. Engineering Solution to Active Issues
### 3. What Should Be Made (Recommended Actions)

Keep the guidance practical, accurate to the numbers in the telemetry snapshot (never invent metrics not present), and concise enough to read quickly inside a side panel (around 220-340 words).`;

  const response = await callGeminiWithRetry((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction:
          'You are the PROMETHEUS-X Dashboard Intelligence Bot, a Principal Industrial Quality, Computer Vision & Manufacturing Reliability Advisor. You explain charts, KPIs, 3D digital twin controls, defect passports, maintenance risk, and governance views clearly for plant engineers and leaders. Ground every number strictly in the provided live telemetry snapshot. Never mention internal API keys, database connection strings, or model internals.',
      },
    })
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Dashboard assistant returned an empty response.');
  }
  return text;
}

