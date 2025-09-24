

// The single source of truth for stage order (left → right in the UI)
export const WORKFLOW_STAGES = [
  { id: 1, key: "Intake",                               name: "Demand Capture",                             description: "Logging of new business demand" },
  { id: 2, key: "Screening",                            name: "Demand Qualification",                       description: "Assess business need, initial validation for business alignment" },
  { id: 3, key: "Assessment",                           name: "Demand Assessment",                          description: "PMO or Portfolio team assesses feasibility, risk, urgency" },
  { id: 4, key: "Evaluation",                           name: "Demand Evaluation",                          description: "Deeper analysis of impact, value, risk, capacity" },
  { id: 5, key: "Authorization",                        name: "Demand Prioritization & Authorization",      description: "Formal evaluation/prioritization by Demand Board/Service Portfolio Board" },
  { id: 6, key: "Business Case Development",            name: "Business Case Development",                  description: "Build formal business case for strategic/complex demands" },
  { id: 7, key: "Service Portfolio Entry",              name: "Service Portfolio Entry / Service Pipeline", description: "Approved demand moves into service/project portfolio" },
  { id: 8, key: "Service Implementation/Monitoring",    name: "Service Implementation / Monitoring",        description: "Demand delivered as project/change, status tracked" },
  { id: 9, key: "Closure",                              name: "Demand Closure",                             description: "Closure & Feedback" },
] as const;

export type StageKey = typeof WORKFLOW_STAGES[number]["key"];

export type WorkflowStage = {
  id: number;
  name: string;
  description: string;
  completed: boolean;
  current?: boolean;
};

/**
 * Build the UI-friendly workflow from the canonical list.
 * Always returns an ARRAY (never undefined).
 */
export function buildWorkflow(currentKey: StageKey | string | null | undefined): WorkflowStage[] {
  const key = String(currentKey ?? "Intake").toLowerCase().trim();

  const currentIndex = Math.max(
    0,
    WORKFLOW_STAGES.findIndex((s) => s.key.toLowerCase() === key)
  );

  return WORKFLOW_STAGES.map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    completed: i < currentIndex,
    current: i === currentIndex,
  }));
}
