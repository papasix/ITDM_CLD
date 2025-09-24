// src/types.ts
export type DemandStatus =
  | "Draft"
  | "Submitted"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Completed";

export type DemandType = "Strategic" | "Operational" | "Support" | "Compliance" | "Innovation";

export type DemandPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface Demand {
  id: string;
  title: string;
  type: DemandType;
  priority: DemandPriority;
  status: DemandStatus;
  currentStage?: string;
  current_stage?: string | null;
  createdDate?: string | null;
  created_date?: string | null;
  expectedDelivery?: string | null;
  expected_delivery?: string | null;
  expected_start_date?: string | null;
  description?: string | null;
  requestor?: string | null;
  department?: string | null;
  progress?: number | null;
  business_justification?: string | null;
  expected_benefits?: string | null;
  risk_assessment?: string | null;
  success_criteria?: string | null;
  estimated_cost?: number | null;
  budget_source?: string | null;
  cost_category?: string | null;
  roi?: number | null;
  last_modified_by?: string | null;
}
