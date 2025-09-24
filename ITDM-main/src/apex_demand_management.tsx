import React, { useEffect, useMemo, useState } from "react";
import { useAADUser } from "./hooks/useAADUser";
import {
  Search,
  Plus,
  Eye,
  Edit,
  Trash2,
  Upload,
  DollarSign,
  FileText,
  Users,
  Clock,
  CheckCircle,
  MessageCircle,
  GitCommit,
  AlertCircle,
} from "lucide-react";

// Types and API imports
import type { Demand } from "./types";
import { listDemands, createDemand, updateDemand, deleteDemand, softDeleteDemand, markAsDeletedInUI } from "./api";
import { APP_CONFIG } from "./constants/app";
import { validateDemand, validateTitle, validateDescription, validateDemandType, validatePriority, sanitizeInput } from "./utils/validation";


/**
 * -----------------------------------------------------------------------------------
 * Safe, local helpers for Comments / Audit / Approvals
 * - These are non-breaking placeholders; if you later add endpoints, they’ll be used.
 * -----------------------------------------------------------------------------------
 */

type DemandComment = { id: string; author: string; body: string; createdAt: string };
type DemandAudit = { id: string; who: string; at: string; action: string; note?: string | null };
type DemandApproval = {
  id: string;
  role: string;
  approver: string;
  status: "Pending" | "Approved" | "Rejected";
  decidedAt?: string | null;
};

//const API_BASE = "/api"; // via Vite proxy
const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');

interface ApiResponse {
  items?: unknown[];
  [key: string]: unknown;
}

interface CommentResponse {
  id?: string;
  ID?: string;
  author?: string;
  AUTHOR?: string;
  body?: string;
  BODY?: string;
  created_at?: string;
  CREATED_AT?: string;
  createdAt?: string;
}

interface AuditResponse {
  id?: string;
  ID?: string;
  who?: string;
  WHO?: string;
  at?: string;
  AT?: string;
  createdAt?: string;
  action?: string;
  ACTION?: string;
  note?: string;
  NOTE?: string;
}

interface ApprovalResponse {
  id?: string;
  ID?: string;
  role?: string;
  ROLE?: string;
  approver?: string;
  APPROVER?: string;
  status?: string;
  STATUS?: string;
  decided_at?: string;
  DECIDED_AT?: string;
  decidedAt?: string;
}

async function tryJson<T>(res: Response): Promise<T> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}

// Comments (optional back-end)
async function fetchComments(demandId: string): Promise<DemandComment[]> {
  try {
    const r = await fetch(`${API_BASE}/demands/${encodeURIComponent(demandId)}/comments?_format=json`);
    if (!r.ok) return [];
    const json = await tryJson<ApiResponse>(r);
    return ((json.items as CommentResponse[]) ?? (json as unknown as CommentResponse[]) ?? []).map((x: CommentResponse) => ({
      id: String(x.id ?? x.ID ?? crypto.randomUUID()),
      author: x.author ?? x.AUTHOR ?? "Unknown",
      body: x.body ?? x.BODY ?? "",
      createdAt: x.created_at ?? x.CREATED_AT ?? x.createdAt ?? "",
    }));
  } catch (error) {
    console.warn('Failed to fetch comments:', error);
    return []; // keep UI alive even without endpoint
  }
}
async function postComment(demandId: string, author: string, body: string): Promise<DemandComment> {
  try {
    const r = await fetch(`${API_BASE}/demands/${encodeURIComponent(demandId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ author, body }),
    });
    if (!r.ok) throw new Error(await r.text());
    const json = await tryJson<CommentResponse>(r);
    return {
      id: String(json.id ?? json.ID ?? crypto.randomUUID()),
      author: json.author ?? author,
      body: json.body ?? body,
      createdAt: json.created_at ?? json.createdAt ?? new Date().toISOString(),
    };
  } catch {
    throw new Error("Comments API is not configured yet.");
  }
}

// Audit (optional back-end)
async function fetchAudit(demandId: string): Promise<DemandAudit[]> {
  try {
    const r = await fetch(`${API_BASE}/demands/${encodeURIComponent(demandId)}/audit?_format=json`);
    if (!r.ok) return [];
    const json = await tryJson<ApiResponse>(r);
    return ((json.items as AuditResponse[]) ?? (json as unknown as AuditResponse[]) ?? []).map((x: AuditResponse) => ({
      id: String(x.id ?? x.ID ?? crypto.randomUUID()),
      who: x.who ?? x.WHO ?? "system",
      at: x.at ?? x.AT ?? x.createdAt ?? "",
      action: x.action ?? x.ACTION ?? "",
      note: x.note ?? x.NOTE ?? null,
    }));
  } catch (error) {
    console.warn('Failed to fetch audit trail:', error);
    return [];
  }
}

// Approvals (optional back-end; the sequential logic below does not depend on these)
async function fetchApprovals(demandId: string): Promise<DemandApproval[]> {
  try {
    // Try the working endpoint first, then fallback to the nested path
    const endpoints = [
      `${API_BASE}/xxitdm_approvals/?q={"demand_id":"${demandId}"}`,
      `${API_BASE}/demands/${encodeURIComponent(demandId)}/approvals?_format=json`
    ];
    
    for (const endpoint of endpoints) {
      try {
        const r = await fetch(endpoint);
        if (r.ok) {
          const json = await tryJson<ApiResponse>(r);
          return ((json.items as ApprovalResponse[]) ?? (json as unknown as ApprovalResponse[]) ?? []).map((x: ApprovalResponse) => ({
            id: String(x.id ?? x.ID ?? crypto.randomUUID()),
            role: x.role ?? x.ROLE ?? "Approver",
            approver: x.approver ?? x.APPROVER ?? "Unknown",
            status: (x.status ?? x.STATUS ?? "Pending") as DemandApproval["status"],
            decidedAt: x.decided_at ?? x.DECIDED_AT ?? x.decidedAt ?? null,
          }));
        }
      } catch (error) {
        console.warn(`Failed to fetch from ${endpoint}:`, error);
        continue;
      }
    }
    return [];
  } catch (error) {
    console.warn('Failed to fetch approvals:', error);
    return [];
  }
}



/** ----------------- Stage helpers (sequential flow) ------------------ */
type Role = "Demand Requestor" | "BU Head" | "ITPMO" | "DBR";
const STAGE_FLOW: Array<{ stage: string; role: Role | null }> = [
  { stage: "Intake", role: "Demand Requestor" },
  { stage: "Screening", role: "BU Head" },
  { stage: "Assessment", role: "ITPMO" },
  { stage: "Authorization", role: "DBR" },
  { stage: "Service Portfolio Entry", role: null },
];
function stageIndex(stage?: string | null) {
  const i = STAGE_FLOW.findIndex((s) => s.stage === (stage ?? "Intake"));
  return i >= 0 ? i : 0;
}
function requiredRoleForStage(stage?: string | null): Role | null {
  return STAGE_FLOW[stageIndex(stage)].role;
}
function nextStageFrom(stage?: string | null): string {
  const i = stageIndex(stage);
  return STAGE_FLOW[Math.min(i + 1, STAGE_FLOW.length - 1)].stage;
}

/** ---------------------------- Component ----------------------------- */
const DemandManagementSystem: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "my-demands" | "submit-demand" | "approval-queue" | "portfolio" | "reports"
  >("my-demands");

  const [activeFormTab, setActiveFormTab] = useState<"basic-info" | "business-case" | "financial" | "attachments">(
    "basic-info"
  );

  //const [currentUserName] = useState("John Smith");

  //SSO Start
  const { 
    name: currentUserName, 
    email: currentUserEmail, 
    isAuthenticated, 
    signIn, 
    signOut 
  } = useAADUser();

  const safeUserName = currentUserName || import.meta.env.VITE_DEV_USER_NAME || "Unknown User";
  //SSO End

  const [currentRole, setCurrentRole] = useState<Role>("Demand Requestor");
  
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "" | "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | "Completed"
  >("");
  const [typeFilter, setTypeFilter] = useState<"" | Demand["type"]>("");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = APP_CONFIG.DEFAULT_PAGE_SIZE;

  const [formData, setFormData] = useState({
    title: "",
    type: "",
    priority: "",
    description: "",
    expectedStartDate: "",
    expectedCompletionDate: "",
    businessJustification: "",
    expectedBenefits: "",
    riskAssessment: "",
    successCriteria: "",
    estimatedCost: "",
    budgetSource: "",
    costCategory: "",
    roi: "",
    attachments: [] as { id: number; name: string; size: number; type: string }[],
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const [demands, setDemands] = useState<Demand[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<Demand | null>(null);
  const [detailTab, setDetailTab] = useState<"details" | "comments" | "audit" | "approvals">("details");

  // Comments/Audit/Approvals state
  const [comments, setComments] = useState<DemandComment[]>([]);
  const [audit, setAudit] = useState<DemandAudit[]>([]);
  const [newComment, setNewComment] = useState("");
  const [approvals, setApprovals] = useState<DemandApproval[]>([]);
  const pendingApprovals = useMemo(() => approvals.filter((a) => a.status === "Pending"), [approvals]);

  useEffect(() => {
    (async () => {
      try {
        const rows = await listDemands(APP_CONFIG.MAX_API_LIMIT); // Get all demands for pagination
        setDemands(rows);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  async function reloadDemands() {
    try {
      const rows = await listDemands(APP_CONFIG.MAX_API_LIMIT); // Get all demands for pagination
      setDemands(rows);
    } catch (error) {
      console.error('Failed to reload demands:', error);
    }
  }

  const filteredDemands = demands.filter((d) => {
    const s = searchTerm.toLowerCase();
    const matchesSearch =
      d.title.toLowerCase().includes(s) ||
      d.id.toLowerCase().includes(s) ||
      (d.description || "").toLowerCase().includes(s);
    const matchesStatus = !statusFilter || d.status === statusFilter;
    const matchesType = !typeFilter || d.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  // Pagination calculations
  const totalPages = Math.ceil(filteredDemands.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedDemands = filteredDemands.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, typeFilter]);

  const getStatusBadge = (status: Demand["status"]) => {
    const map: Record<Demand["status"], string> = {
      Draft: "bg-gray-100 text-gray-800",
      Submitted: "bg-blue-100 text-blue-800",
      "Under Review": "bg-yellow-100 text-yellow-800",
      Approved: "bg-green-100 text-green-800",
      Rejected: "bg-red-100 text-red-800",
      Completed: "bg-green-100 text-green-800",
    };
    return `px-2 py-1 rounded-full text-xs font-semibold uppercase ${map[status]}`;
  };
  const getPriorityBadge = (p: Demand["priority"]) => {
    const cls: Record<Demand["priority"], string> = {
      CRITICAL: "bg-red-500 text-white",
      HIGH: "bg-orange-500 text-white",
      MEDIUM: "bg-blue-500 text-white",
      LOW: "bg-gray-500 text-white",
    };
    // Fix size and center align text
      return `inline-flex items-center justify-center rounded-full 
          px-3 text-xs font-semibold 
          h-6 min-w-[80px] 
          ${cls[p]}`;
    //return `px-2 py-1 rounded-full text-xs font-semibold ${cls[p]}`;
  };

  // 1) Keep typing raw; validate live
const handleFormChange = (field: string, value: string) => {
  // Always store exactly what user typed
  setFormData(p => ({ ...p, [field]: value }));

  // Real-time validation against what they see
  let fieldError = '';
  switch (field) {
    case 'title': {
      const r = validateTitle(value);
      if (!r.valid) fieldError = r.error!;
      break;
    }
    case 'description': {
      const r = validateDescription(value);
      if (!r.valid) fieldError = r.error!;
      break;
    }
    case 'type': {
      const r = validateDemandType(value);
      if (!r.valid) fieldError = r.error!;
      break;
    }
    case 'priority': {
      const r = validatePriority(value);
      if (!r.valid) fieldError = r.error!;
      break;
    }
  }
  setFormErrors(p => ({ ...p, [field]: fieldError }));
};
  /*
  const handleFormChange = (field: string, value: string) => {
    const sanitizedValue = sanitizeInput(value);
    setFormData((p) => ({ ...p, [field]: sanitizedValue }));    
    // Real-time validation
    let fieldError = '';
    switch (field) {
      case 'title':
        const titleValidation = validateTitle(sanitizedValue);
        if (!titleValidation.valid) fieldError = titleValidation.error!;
        break;
      case 'description':
        const descValidation = validateDescription(sanitizedValue);
        if (!descValidation.valid) fieldError = descValidation.error!;
        break;
      case 'type':
        const typeValidation = validateDemandType(sanitizedValue);
        if (!typeValidation.valid) fieldError = typeValidation.error!;
        break;
      case 'priority':
        const priorityValidation = validatePriority(sanitizedValue);
        if (!priorityValidation.valid) fieldError = priorityValidation.error!;
        break;
    }
    
    setFormErrors(prev => {
      const newErrors = { ...prev };
      if (fieldError) {
        newErrors[field] = fieldError;
      } else {
        delete newErrors[field];
      }
      return newErrors;
    });
  };
  */  
  const handleFileUpload = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files).map((f) => ({
      id: Date.now() + Math.random(),
      name: f.name,
      size: f.size,
      type: f.type,
    }));
    setFormData((p) => ({ ...p, attachments: [...p.attachments, ...newFiles] }));
  };
  function resetFormAndGoBack() {
    setFormData({
      title: "",
      type: "",
      priority: "",
      description: "",
      expectedStartDate: "",
      expectedCompletionDate: "",
      businessJustification: "",
      expectedBenefits: "",
      riskAssessment: "",
      successCriteria: "",
      estimatedCost: "",
      budgetSource: "",
      costCategory: "",
      roi: "",
      attachments: [],
    });
    setFormErrors({});
    setActiveTab("my-demands");
  }

  /** Save as draft — stays in Intake */
  async function handleSaveDraft() {
    try {
      const draft = await createDemand({
        title: formData.title || "(Untitled)",
        type: (formData.type as Demand["type"]) || "Strategic",
        priority: (formData.priority as Demand["priority"]) || "LOW",
        status: "Draft",
        current_stage: "Intake",
        expected_delivery: formData.expectedCompletionDate || undefined,
        expected_start_date: formData.expectedStartDate || undefined,
        business_justification: formData.businessJustification || undefined,
        expected_benefits: formData.expectedBenefits || undefined,
        risk_assessment: formData.riskAssessment || undefined,
        success_criteria: formData.successCriteria || undefined,
        estimated_cost: formData.estimatedCost !== "" ? Number(formData.estimatedCost) : undefined,
        budget_source: formData.budgetSource || undefined,
        cost_category: formData.costCategory || undefined,
        roi: formData.roi !== "" ? Number(formData.roi) : undefined,
        description: formData.description,
        // replace currentUserName with safeUserName
        //requestor: currentUserName,
        requestor: safeUserName,
        department: "Information Technology",
        progress: 0,
      });
      setDemands((prev) => [draft, ...prev]);
      await reloadDemands();
      alert(`Draft saved: ${draft.id}`);
      resetFormAndGoBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Save failed: ${message}`);
    }
  }

  /** Submit — move directly to Screening (BU Head), set Under Review */
  async function handleSubmitDemand() {
    // Validate entire demand before submission
    const validation = validateDemand({
      title: formData.title,
      description: formData.description,
      type: formData.type,
      priority: formData.priority
    });
    
    if (!validation.valid) {
      alert(`Validation failed:\n${validation.errors.join('\n')}`);
      return;
    }
    
    try {
      const created = await createDemand({
        title: sanitizeInput(formData.title),
        type: (formData.type as Demand["type"]) || "Strategic",
        priority: (formData.priority as Demand["priority"]) || "MEDIUM",
        status: "Under Review",
        current_stage: "Screening", // first approver is BU Head
        expected_delivery: formData.expectedCompletionDate || undefined,
        expected_start_date: formData.expectedStartDate || undefined,
        business_justification: sanitizeInput(formData.businessJustification || '') || undefined,
        expected_benefits: sanitizeInput(formData.expectedBenefits || '') || undefined,
        risk_assessment: sanitizeInput(formData.riskAssessment || '') || undefined,
        success_criteria: sanitizeInput(formData.successCriteria || '') || undefined,
        estimated_cost: formData.estimatedCost !== "" ? Number(formData.estimatedCost) : undefined,
        budget_source: formData.budgetSource || undefined,
        cost_category: formData.costCategory || undefined,
        roi: formData.roi !== "" ? Number(formData.roi) : undefined,
        description: sanitizeInput(formData.description),
        requestor: currentUserName,
        department: "Information Technology",
        progress: 0,
      });
      setDemands((prev) => [created, ...prev]);
      await reloadDemands();
      alert(`Demand ${created.id} submitted successfully!`);
      resetFormAndGoBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Submit failed: ${message}`);
    }
  }

  async function handleEdit(d: Demand) {
    const description = prompt("New description:", d.description || "");
    if (description == null) return;
    try {
      const updated = await updateDemand(d.id, { description, last_modified_by: currentUserName });
      setDemands((rows) => rows.map((r) => (r.id === d.id ? updated : r)));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Update failed: ${message}`);
    }
  }
  async function handleDelete(d: Demand) {
    if (d.status !== "Draft") {
      alert("Only drafts can be deleted.");
      return;
    }
    if (!confirm(`Delete ${d.id}?`)) return;
    const snapshot = demands;
    try {
      setDemands((rows) => rows.filter((r) => r.id !== d.id));
      await deleteDemand(d.id);
      
      // Small delay to ensure database transaction is committed
      await new Promise(resolve => setTimeout(resolve, APP_CONFIG.DELETE_CONFIRMATION_DELAY));
      await reloadDemands();
      
      console.log(`✅ Successfully deleted ${d.id} from database and refreshed UI`);
    } catch (error) {
      setDemands(snapshot);
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('DELETE failed, checking alternatives:', error);
      
      // Offer alternative approaches
      const useAlternative = confirm(`Physical delete failed: ${message}\n\nWould you like to try soft delete instead? (This will mark the demand as deleted but keep the record)`);
      
      if (useAlternative) {
        try {
          console.log('Attempting soft delete...');
          await softDeleteDemand(d.id);
          await reloadDemands();
          alert(`Soft delete successful for ${d.id}. The demand has been marked as deleted.`);
        } catch (softError) {
          console.error('Soft delete also failed:', softError);
          
          // Show detailed error information
          console.log('🔍 Delete failure analysis:');
          console.log('Hard delete error:', message);
          console.log('Soft delete error:', softError);
          
          // Immediate UI fallback without asking - since DB operations are clearly not working
          setDemands(prev => markAsDeletedInUI(prev, d.id));
          alert(`❌ Database delete operations are not working.\n\n✅ ${d.id} has been removed from the display.\n\n⚠️  Note: The record still exists in the database.\n\nTo fix permanently, your system admin needs to:\n1. Enable ORDS DELETE operations\n2. Check database constraints\n3. Review table permissions`);
        }
      } else {
        alert(`Delete failed: ${message}\n\nPlease contact your system administrator for assistance.`);
      }
    }
  }

  const openDemandModal = async (d: Demand) => {
    setSelectedDemand(d);
    setDetailTab("details");
    setShowModal(true);
    try {
      const [c, a, ap] = await Promise.all([fetchComments(d.id), fetchAudit(d.id), fetchApprovals(d.id)]);
      setComments(c);
      setAudit(a);
      setApprovals(ap);
    } catch (error) {
      console.warn('Failed to fetch demand details:', error);
    }
  };

  // --- sequential approve / reject from modal ---
  const userCanActOnSelected = selectedDemand
    ? requiredRoleForStage(selectedDemand.current_stage || selectedDemand.currentStage) === currentRole &&
      (selectedDemand.status === "Submitted" || selectedDemand.status === "Under Review")
    : false;

  async function approveSelected() {
    if (!selectedDemand) return;
    
    console.log('=== APPROVAL PROCESS STARTING ===');
    console.log('Selected demand:', selectedDemand);
    console.log('Current user role:', currentRole);
    
    const current = selectedDemand.current_stage || selectedDemand.currentStage || "Intake";
    const i = stageIndex(current);
    const isLastApprover = i >= STAGE_FLOW.findIndex((s) => s.stage === "Authorization"); // DBR is last approver
    const nextStage = nextStageFrom(current);

    console.log('Approval logic:', {
      currentStage: current,
      stageIndex: i,
      isLastApprover,
      nextStage,
      requiredRole: requiredRoleForStage(current)
    });

    const patch =
      isLastApprover
        ? { status: "Approved" as const, current_stage: nextStage }
        : { status: "Under Review" as const, current_stage: nextStage };

    console.log('Patch to apply:', patch);

    try {
      console.log('Calling updateDemand with ID:', selectedDemand.id);
      const updated = await updateDemand(selectedDemand.id, patch);
      console.log('Update successful:', updated);
      const merged = { ...selectedDemand, ...updated };
      //setDemands((rows) => rows.map((r) => (r.id === selectedDemand.id ? updated : r)));
      setDemands((rows) => rows.map((r) => (r.id === selectedDemand.id ? merged : r)));
      //setSelectedDemand(updated);
      setSelectedDemand(merged);
      alert(isLastApprover ? "Approved. Demand is now Approved." : `Approved. Moved to ${nextStage}.`);
    } catch (error) {
      console.error('=== APPROVAL FAILED ===');
      console.error('Full error object:', error);
      console.error('Error type:', typeof error);
      console.error('Error constructor:', error?.constructor?.name);
      
      const message = error instanceof Error ? error.message : 'Unknown error';
      const fullMessage = `Approval failed with detailed info:\n\nDemand ID: ${selectedDemand.id}\nCurrent Stage: ${current}\nNext Stage: ${nextStage}\nUser Role: ${currentRole}\nPatch: ${JSON.stringify(patch)}\n\nError: ${message}`;
      
      alert(fullMessage);
    }
  }
  async function rejectSelected() {
    if (!selectedDemand) return;
    try {
      const updated = await updateDemand(selectedDemand.id, { status: "Rejected" as const });
      setDemands((rows) => rows.map((r) => (r.id === selectedDemand.id ? updated : r)));
      setSelectedDemand(updated);
      alert("Demand rejected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      alert(`Reject failed: ${message}`);
    }
  }

  const summary = {
    total: demands.length,
    pending: demands.filter((d) => d.status === "Submitted" || d.status === "Under Review").length,
    inProgress: demands.filter((d) => d.status === "Approved").length,
    completed: demands.filter((d) => d.status === "Completed").length,
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">IT Demand Management</h1>
              <p className="mt-2 text-sm text-red-600">In Development</p>
            </div>
            <div className="flex items-center space-x-4">
              {/*<div className="text-sm text-gray-600">Welcome, {currentUserName}</div>*/}
              {/*Start*/}
              <div className="text-sm text-gray-600">
              {isAuthenticated ? <>Welcome, {safeUserName}</> : <>Not signed in</>}
                </div>
                {!isAuthenticated ? (
                  <button
                    onClick={signIn}
                    className="px-2 py-1 text-sm bg-blue-600 text-white rounded"
                  >
                    Sign in
                  </button>
                ) : (
                  <button
                    onClick={signOut}
                    className="px-2 py-1 text-sm bg-gray-200 rounded"
                  >
                    Sign out
                  </button>
                )}

                {/*End*/}
              {/*<div className="text-sm text-gray-600">IT Operations</div>*/}
              <select
                value={currentRole}
                onChange={(e) => setCurrentRole(e.target.value as Role)}
                className="px-2 py-1 border border-gray-300 rounded-md text-sm"
                title="Current Role"
              >
                <option>Demand Requestor</option>
                <option>BU Head</option>
                <option>ITPMO</option>
                <option>DBR</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex space-x-8">
            {[
              { id: "dashboard", label: "Dashboard" },
              { id: "my-demands", label: "My Demands" },
              { id: "submit-demand", label: "Submit New Demand" },
              { id: "approval-queue", label: "Approval Queue" },
              { id: "portfolio", label: "Portfolio" },
              { id: "reports", label: "Reports" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === (tab.id as typeof activeTab)
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Dashboard */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            {/* Key Metrics Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Total Demands</dt>
                      <dd className="text-3xl font-semibold text-gray-900">{demands.length}</dd>
                    </dl>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-green-600">↗ +12% from last month</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                      <Clock className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Pending Review</dt>
                      <dd className="text-3xl font-semibold text-gray-900">{demands.filter(d => d.status === 'Under Review').length}</dd>
                    </dl>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-red-600">↗ +3 from yesterday</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <CheckCircle className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Completed (MTD)</dt>
                      <dd className="text-3xl font-semibold text-gray-900">{demands.filter(d => d.status === 'Completed').length}</dd>
                    </dl>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-green-600">↗ On track with goals</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 truncate">Budget Utilized</dt>
                      <dd className="text-3xl font-semibold text-gray-900">68%</dd>
                    </dl>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-blue-600">$2.4M of $3.5M</div>
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Demand Status Distribution */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Demand Status Distribution</h3>
                <div className="space-y-3">
                  {['Submitted', 'Under Review', 'Approved', 'Draft'].map(status => {
                    const count = demands.filter(d => d.status === status).length;
                    const percentage = demands.length > 0 ? Math.round((count / demands.length) * 100) : 0;
                    return (
                      <div key={status} className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className={`w-4 h-4 rounded mr-3 ${
                            status === 'Submitted' ? 'bg-blue-500' :
                            status === 'Under Review' ? 'bg-yellow-500' :
                            status === 'Approved' ? 'bg-green-500' :
                            'bg-gray-500'
                          }`} />
                          <span className="text-sm text-gray-600">{status}</span>
                        </div>
                        <span className="text-sm font-medium">{count} ({percentage}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Priority Distribution */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Priority Distribution</h3>
                <div className="space-y-4">
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(priority => {
                    const count = demands.filter(d => d.priority === priority).length;
                    const percentage = demands.length > 0 ? Math.round((count / demands.length) * 100) : 0;
                    return (
                      <div key={priority}>
                        <div className="flex justify-between mb-1">
                          <span className={`text-sm font-medium ${
                            priority === 'CRITICAL' ? 'text-red-600' :
                            priority === 'HIGH' ? 'text-orange-600' :
                            priority === 'MEDIUM' ? 'text-blue-600' :
                            'text-gray-600'
                          }`}>{priority}</span>
                          <span className="text-sm text-gray-500">{count}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className={`h-2 rounded-full ${
                            priority === 'CRITICAL' ? 'bg-red-500' :
                            priority === 'HIGH' ? 'bg-orange-500' :
                            priority === 'MEDIUM' ? 'bg-blue-500' :
                            'bg-gray-500'
                          }`} style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Recent Activity & Deadlines */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Recent Activity */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h3>
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">DEM-2024-015</span> approved by Portfolio Committee
                      </p>
                      <p className="text-xs text-gray-500">2 hours ago</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <FileText className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        New demand <span className="font-medium">DEM-2024-021</span> submitted by Sarah Johnson
                      </p>
                      <p className="text-xs text-gray-500">4 hours ago</p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">
                        <span className="font-medium">DEM-2024-018</span> requires additional information
                      </p>
                      <p className="text-xs text-gray-500">6 hours ago</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Upcoming Deadlines */}
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Upcoming Deadlines</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">DEM-2024-003</p>
                      <p className="text-xs text-gray-500">Mobile App Integration</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-red-600">Tomorrow</p>
                      <p className="text-xs text-gray-500">Impact Analysis Due</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">DEM-2024-007</p>
                      <p className="text-xs text-gray-500">Database Optimization</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-yellow-600">3 days</p>
                      <p className="text-xs text-gray-500">Portfolio Review Due</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">DEM-2024-012</p>
                      <p className="text-xs text-gray-500">Security Enhancement</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-blue-600">1 week</p>
                      <p className="text-xs text-gray-500">Solution Design Due</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* My Demands */}
        {activeTab === "my-demands" && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[16rem]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search demands by title, number, or description..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(
                      e.target.value as "" | "Draft" | "Submitted" | "Under Review" | "Approved" | "Rejected" | "Completed"
                    )
                  }
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Status</option>
                  <option value="Draft">Draft</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Under Review">Under Review</option>
                  <option value="Approved">Approved</option>
                  <option value="Completed">Completed</option>
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as Demand["type"] | "")}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">All Types</option>
                  <option value="Strategic">Strategic</option>
                  <option value="Operational">Operational</option>
                  <option value="Support">Support</option>
                  <option value="Compliance">Compliance</option>
                  <option value="Innovation">Innovation</option>
                </select>

                <button
                  onClick={() => setActiveTab("submit-demand")}
                  className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Demand
                </button>
              </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="text-sm font-medium text-gray-600 mb-2">Total Demands</div>
                <div className="text-3xl font-bold text-blue-600">{summary.total}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="text-sm font-medium text-gray-600 mb-2">Pending Approval</div>
                <div className="text-3xl font-bold text-yellow-600">{summary.pending}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="text-sm font-medium text-gray-600 mb-2">In Progress</div>
                <div className="text-3xl font-bold text-blue-600">{summary.inProgress}</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <div className="text-sm font-medium text-gray-600 mb-2">Completed</div>
                <div className="text-3xl font-bold text-green-600">{summary.completed}</div>
              </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">My Demand Requests</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">DEMAND #</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TITLE</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">TYPE</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PRIORITY</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">STATUS</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CURRENT STAGE</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CREATED</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">EXPECTED DELIVERY</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {paginatedDemands.map((demand) => (
                      <tr key={demand.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">{demand.id}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">{demand.title}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{demand.type}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={getPriorityBadge(demand.priority)}>{demand.priority}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={getStatusBadge(demand.status)}>{demand.status}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-gray-900">{demand.current_stage ?? demand.currentStage}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{demand.created_date ?? demand.createdDate}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{demand.expected_delivery ?? demand.expectedDelivery}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => openDemandModal(demand)}
                              className="text-blue-600 hover:text-blue-900 p-1"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {(demand.status === "Draft" || demand.status === "Submitted") && (
                              <button
                                onClick={() => handleEdit(demand)}
                                className="text-green-600 hover:text-green-900 p-1"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                            )}
                            {demand.status === "Draft" && (
                              <button
                                onClick={() => handleDelete(demand)}
                                className="text-red-600 hover:text-red-900 p-1"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white px-6 py-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    Showing {Math.min(startIndex + 1, filteredDemands.length)}-{Math.min(endIndex, filteredDemands.length)} of {filteredDemands.length} demands
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className={`px-3 py-1 border border-gray-300 rounded text-sm ${
                        currentPage === 1 
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button 
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={currentPage === totalPages}
                      className={`px-3 py-1 border border-gray-300 rounded text-sm ${
                        currentPage === totalPages 
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit New Demand */}
        {activeTab === "submit-demand" && (
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Submit New Demand</h3>
            </div>

            {/* Form Tabs */}
            <div className="border-b border-gray-200">
              <nav className="flex px-6">
                {[
                  { id: "basic-info", label: "Basic Information", icon: FileText },
                  { id: "business-case", label: "Business Case", icon: Users },
                  { id: "financial", label: "Financial Details", icon: DollarSign },
                  { id: "attachments", label: "Attachments", icon: Upload },
                ].map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveFormTab(tab.id as typeof activeFormTab)}
                      className={`flex items-center py-4 px-6 border-b-2 font-medium text-sm transition-colors ${
                        activeFormTab === (tab.id as typeof activeFormTab)
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {tab.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div className="p-6">
              {/* BASIC INFO */}
              {activeFormTab === "basic-info" && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Demand Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => handleFormChange("title", e.target.value)}
                      placeholder="Enter a descriptive title for your demand"
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.title ? 'border-red-500' : 'border-gray-300'}`}
                    />
                    {formErrors.title && <p className="text-red-500 text-sm mt-1">{formErrors.title}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Demand Type <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => handleFormChange("type", e.target.value)}
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.type ? 'border-red-500' : 'border-gray-300'}`}
                      >
                        <option value="">-- Select Type --</option>
                        <option value="Strategic">Strategic Initiative</option>
                        <option value="Operational">Operational Improvement</option>
                        <option value="Support">Support Request</option>
                        <option value="Compliance">Compliance Requirement</option>
                        <option value="Innovation">Innovation Project</option>
                      </select>
                      {formErrors.type && <p className="text-red-500 text-sm mt-1">{formErrors.type}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Business Priority <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.priority}
                        onChange={(e) => handleFormChange("priority", e.target.value)}
                        className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.priority ? 'border-red-500' : 'border-gray-300'}`}
                      >
                        <option value="">-- Select Priority --</option>
                        <option value="CRITICAL">Critical - Business Stopping</option>
                        <option value="HIGH">High - Significant Impact</option>
                        <option value="MEDIUM">Medium - Moderate Impact</option>
                        <option value="LOW">Low - Nice to Have</option>
                      </select>
                      {formErrors.priority && <p className="text-red-500 text-sm mt-1">{formErrors.priority}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={6}
                      value={formData.description}
                      onChange={(e) => handleFormChange("description", e.target.value)}
                      placeholder="Provide a detailed description..."
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.description ? 'border-red-500' : 'border-gray-300'}`}
                    />
                    {formErrors.description && <p className="text-red-500 text-sm mt-1">{formErrors.description}</p>}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Expected Start Date</label>
                      <input
                        type="date"
                        value={formData.expectedStartDate}
                        onChange={(e) => handleFormChange("expectedStartDate", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Expected Completion Date</label>
                      <input
                        type="date"
                        value={formData.expectedCompletionDate}
                        onChange={(e) => handleFormChange("expectedCompletionDate", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-md">
                    <h4 className="text-sm font-medium text-gray-700 mb-3">Requestor Information (Auto-populated from AAD)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-gray-500">Employee Name</label>
                        <div className="text-sm font-medium text-gray-900">{currentUserName}</div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500">Department</label>
                        <div className="text-sm font-medium text-gray-900">Information Technology</div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500">Organization</label>
                        <div className="text-sm font-medium text-gray-900">Dubai World Trade Centre</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BUSINESS CASE */}
              {activeFormTab === "business-case" && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Business Justification</label>
                    <textarea
                      rows={4}
                      value={formData.businessJustification}
                      onChange={(e) => handleFormChange("businessJustification", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Expected Benefits</label>
                    <textarea
                      rows={4}
                      value={formData.expectedBenefits}
                      onChange={(e) => handleFormChange("expectedBenefits", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Risk Assessment</label>
                    <textarea
                      rows={4}
                      value={formData.riskAssessment}
                      onChange={(e) => handleFormChange("riskAssessment", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Success Criteria</label>
                    <textarea
                      rows={4}
                      value={formData.successCriteria}
                      onChange={(e) => handleFormChange("successCriteria", e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* FINANCIAL */}
              {activeFormTab === "financial" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Estimated Cost (USD)</label>
                      <input
                        type="number"
                        value={formData.estimatedCost}
                        onChange={(e) => handleFormChange("estimatedCost", e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Budget Source</label>
                      <select
                        value={formData.budgetSource}
                        onChange={(e) => handleFormChange("budgetSource", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">-- Select Budget Source --</option>
                        <option value="OPEX">Operational Budget (OPEX)</option>
                        <option value="CAPEX">Capital Budget (CAPEX)</option>
                        <option value="PROJECT">Project Budget</option>
                        <option value="DEPARTMENT">Department Budget</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cost Category</label>
                      <select
                        value={formData.costCategory}
                        onChange={(e) => handleFormChange("costCategory", e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">-- Select Category --</option>
                        <option value="HARDWARE">Hardware</option>
                        <option value="SOFTWARE">Software Licensing</option>
                        <option value="SERVICES">Professional Services</option>
                        <option value="RESOURCES">Internal Resources</option>
                        <option value="TRAINING">Training & Development</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Expected ROI (%)</label>
                      <input
                        type="number"
                        value={formData.roi}
                        onChange={(e) => handleFormChange("roi", e.target.value)}
                        placeholder="0"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ATTACHMENTS */}
              {activeFormTab === "attachments" && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Supporting Documents</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors">
                      <Upload className="mx-auto h-12 w-12 text-gray-400" />
                      <div className="mt-4">
                        <label htmlFor="file-upload" className="cursor-pointer">
                          <span className="mt-2 block text-sm font-medium text-gray-900">Drop files here or click to upload</span>
                          <input id="file-upload" name="file-upload" type="file" multiple className="sr-only" onChange={(e) => handleFileUpload(e.target.files)} />
                        </label>
                        <p className="mt-1 text-xs text-gray-500">Supported formats: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG (Max 10MB each)</p>
                      </div>
                    </div>
                  </div>

                  {!!formData.attachments.length && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-3">Uploaded Files</h4>
                      <div className="space-y-2">
                        {formData.attachments.map((file) => (
                          <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                            <div className="flex items-center">
                              <FileText className="h-5 w-5 text-gray-400 mr-3" />
                              <div>
                                <div className="text-sm font-medium text-gray-900">{file.name}</div>
                                <div className="text-xs text-gray-500">
                                  {((bytes: number) => {
                                    if (bytes === 0) return "0 Bytes";
                                    const k = 1024;
                                    const sizes = ["Bytes", "KB", "MB", "GB"];
                                    const i = Math.floor(Math.log(bytes) / Math.log(k));
                                    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
                                  })(file.size)}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => setFormData((p) => ({ ...p, attachments: p.attachments.filter((f) => f.id !== file.id) }))}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-between pt-6 border-t">
                <button
                  onClick={() => setActiveTab("my-demands")}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <div className="space-x-3">
                  <button
                    onClick={handleSaveDraft}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Save as Draft
                  </button>
                  {/*<RequireAuth>*/}
                  <button
                    onClick={handleSubmitDemand}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
                  >
                    Submit Demand
                  </button>
                  {/*</RequireAuth>*/}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Approval Queue */}
        {activeTab === "approval-queue" && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-lg font-medium text-gray-900">Approval Queue</h3>
                <div className="text-sm text-gray-600">Role: {currentRole}</div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Demand #</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {demands
                      .filter((d) => d.status === "Under Review" || d.status === "Submitted")
                      .filter((d) => requiredRoleForStage(d.current_stage ?? d.currentStage) === currentRole)
                      .map((d) => (
                        <tr key={d.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap font-semibold">{d.id}</td>
                          <td className="px-6 py-4">{d.title}</td>
                          <td className="px-6 py-4">{d.current_stage ?? d.currentStage}</td>
                          <td className="px-6 py-4 whitespace-nowrap">{d.created_date ?? d.createdDate}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                            <button
                              onClick={() => openDemandModal(d)}
                              className="text-blue-600 hover:text-blue-900 p-1"
                              title="View"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-white px-6 py-3 border-t border-gray-200">
                <div className="text-sm text-gray-500">
                  Showing approvals for role: <span className="font-medium">{currentRole}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reports */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            {/* Report Categories */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">Executive Reports</h3>
                    <p className="text-sm text-gray-500">High-level portfolio insights</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-blue-600">5 available reports</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">Operational Reports</h3>
                    <p className="text-sm text-gray-500">Detailed demand analytics</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-green-600">12 available reports</div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-white" />
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">Financial Reports</h3>
                    <p className="text-sm text-gray-500">Budget and cost analysis</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-sm text-purple-600">8 available reports</div>
                </div>
              </div>
            </div>

            {/* Quick Reports */}
            <div className="bg-white rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Quick Reports</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Standard Reports</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Demand Status Summary</div>
                          <div className="text-xs text-gray-500">Overview of all demand statuses ({demands.length} total demands)</div>
                        </div>
                        <button 
                          onClick={() => {
                            const statusReport = demands.reduce((acc: Record<string, number>, d) => {
                              acc[d.status] = (acc[d.status] || 0) + 1;
                              return acc;
                            }, {});
                            alert(`Demand Status Summary:\n${Object.entries(statusReport).map(([status, count]) => `${status}: ${count}`).join('\n')}`);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">SLA Performance</div>
                          <div className="text-xs text-gray-500">Service level agreement tracking</div>
                        </div>
                        <button 
                          onClick={() => alert('SLA Performance Report:\nAverage processing time: 3.2 days\nOn-time delivery: 87%\nEscalated demands: 5')}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Resource Utilization</div>
                          <div className="text-xs text-gray-500">Team capacity and allocation</div>
                        </div>
                        <button 
                          onClick={() => alert('Resource Utilization Report:\nTeam capacity: 85% utilized\nActive projects: 12\nResource allocation efficiency: Good')}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-medium text-gray-900">Custom Reports</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Portfolio ROI Analysis</div>
                          <div className="text-xs text-gray-500">Return on investment metrics</div>
                        </div>
                        <button 
                          onClick={() => alert('Portfolio ROI Analysis:\nTotal investment: $2.4M\nExpected ROI: 23%\nPayback period: 18 months')}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Demand Trends</div>
                          <div className="text-xs text-gray-500">Historical demand patterns ({demands.length} current demands)</div>
                        </div>
                        <button 
                          onClick={() => {
                            const typeReport = demands.reduce((acc: Record<string, number>, d) => {
                              acc[d.type] = (acc[d.type] || 0) + 1;
                              return acc;
                            }, {});
                            alert(`Demand Trends by Type:\n${Object.entries(typeReport).map(([type, count]) => `${type}: ${count} (${Math.round((count/demands.length)*100)}%)`).join('\n')}`);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div>
                          <div className="text-sm font-medium text-gray-900">Budget Variance</div>
                          <div className="text-xs text-gray-500">Actual vs planned spending</div>
                        </div>
                        <button 
                          onClick={() => alert('Budget Variance Report:\nPlanned: $3.5M\nActual: $2.4M\nVariance: -31.4% (Under budget)\nForecast accuracy: 94%')}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Generate
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Report Builder */}
            <div className="bg-white rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">Custom Report Builder</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option>Demand Analysis</option>
                      <option>Financial Summary</option>
                      <option>Resource Planning</option>
                      <option>Performance Metrics</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Date Range</label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option>Last 30 days</option>
                      <option>Last Quarter</option>
                      <option>Year to Date</option>
                      <option>Custom Range</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Format</label>
                    <select className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option>Excel (XLSX)</option>
                      <option>PDF</option>
                      <option>CSV</option>
                      <option>PowerPoint</option>
                    </select>
                  </div>
                </div>
                <div className="mt-6">
                  <button 
                    onClick={() => alert('Custom report would be built with selected parameters and downloaded. Feature not fully implemented in prototype.')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Build Report
                  </button>
                </div>
              </div>
            </div>

            {/* Scheduled Reports */}
            <div className="bg-white rounded-lg shadow-sm">
              <div className="px-6 py-4 border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-medium text-gray-900">Scheduled Reports</h3>
                  <button 
                    onClick={() => alert('Schedule management interface would open here. Feature not fully implemented in prototype.')}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Add Schedule
                  </button>
                </div>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">Weekly Portfolio Summary</div>
                      <div className="text-xs text-gray-500">Every Monday at 8:00 AM</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full">
                        ACTIVE
                      </span>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">Monthly Financial Report</div>
                      <div className="text-xs text-gray-500">First Monday of each month</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded-full">
                        ACTIVE
                      </span>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-gray-900">Quarterly Executive Dashboard</div>
                      <div className="text-xs text-gray-500">Every quarter end</div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className="px-2 py-1 text-xs font-semibold bg-gray-100 text-gray-800 rounded-full">
                        PAUSED
                      </span>
                      <button className="text-gray-400 hover:text-gray-600">
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Demand Details Modal */}
      {showModal && selectedDemand && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-30 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-medium text-gray-900">
                {selectedDemand.id} — {selectedDemand.title}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700" aria-label="Close">
                ✕
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="px-6 pt-4">
              <div className="flex items-center space-x-4 border-b">
                {[
                  { id: "details", label: "Details", icon: Eye },
                  { id: "comments", label: "Comments", icon: MessageCircle },
                  { id: "audit", label: "Audit Trail", icon: GitCommit },
                  { id: "approvals", label: "Approvals", icon: Users },
                ].map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setDetailTab(t.id as typeof detailTab)}
                      className={`flex items-center py-3 px-2 border-b-2 -mb-px text-sm ${
                        detailTab === (t.id as typeof detailTab)
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-6">
              {/* DETAILS */}
              {detailTab === "details" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500">Type</div>
                        <div className="font-medium">{selectedDemand.type}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Priority</div>
                        <div>
                          <span className={getPriorityBadge(selectedDemand.priority)}>{selectedDemand.priority}</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500">Created</div>
                        <div className="font-medium">{selectedDemand.created_date ?? selectedDemand.createdDate}</div>
                      </div>
                      <div>
                        <div className="text-gray-500">Expected Delivery</div>
                        <div className="font-medium">{selectedDemand.expected_delivery ?? selectedDemand.expectedDelivery}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500 mb-1">Description</div>
                      <div className="text-sm text-gray-900 whitespace-pre-wrap">{selectedDemand.description}</div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-medium text-gray-900">Workflow Progress</h4>
                      <span className={getStatusBadge(selectedDemand.status)}>{selectedDemand.status}</span>
                    </div>

                    <div className="space-y-3">
                      {STAGE_FLOW.map((s, idx) => {
                        const current = stageIndex(selectedDemand.current_stage ?? selectedDemand.currentStage);
                        const completed = idx < current;
                        const isCurrent = idx === current;
                        return (
                          <div key={s.stage} className="flex items-start space-x-3">
                            <div
                              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                completed
                                  ? "bg-green-500 text-white"
                                  : isCurrent
                                  ? "bg-yellow-500 text-white"
                                  : "bg-gray-200 text-gray-600"
                              }`}
                            >
                              {completed ? <CheckCircle className="w-4 h-4" /> : isCurrent ? <Clock className="w-4 h-4" /> : idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm font-medium ${completed ? "text-green-800" : isCurrent ? "text-yellow-800" : "text-gray-500"}`}>
                                {s.stage}
                              </div>
                              {s.role && <div className="text-xs text-gray-500">Approver: {s.role}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500">Overall Progress</span>
                        <span className="font-medium">{selectedDemand.progress ?? 0}%</span>
                      </div>
                      <div className="mt-1 bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${selectedDemand.progress ?? 0}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* COMMENTS */}
              {detailTab === "comments" && (
                <div className="space-y-4">
                  <div className="space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className="p-3 bg-gray-50 rounded">
                        <div className="text-sm">
                          <span className="font-medium">{c.author}</span>{" "}
                          <span className="text-gray-500">• {c.createdAt}</span>
                        </div>
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">{c.body}</div>
                      </div>
                    ))}
                    {comments.length === 0 && <div className="text-sm text-gray-500">No comments yet.</div>}
                  </div>

                  <div className="flex space-x-2">
                    <input
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment…"
                      className="flex-1 px-3 py-2 border rounded-md"
                    />
                    <button
                      onClick={async () => {
                        if (!newComment.trim() || !selectedDemand) return;
                        try {
                          const c = await postComment(selectedDemand.id, currentUserName, newComment.trim());
                          setComments((prev) => [c, ...prev]);
                          setNewComment("");
                        } catch (error) {
                          const message = error instanceof Error ? error.message : "Failed to add comment.";
                          alert(message);
                        }
                      }}
                      className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                      Post
                    </button>
                  </div>
                </div>
              )}

              {/* AUDIT */}
              {detailTab === "audit" && (
                <div className="space-y-3">
                  {audit.map((a) => (
                    <div key={a.id} className="flex items-start space-x-3">
                      <GitCommit className="w-4 h-4 mt-1 text-gray-400" />
                      <div className="text-sm">
                        <div>
                          <span className="font-medium">{a.who}</span>{" "}
                          <span className="text-gray-500">• {a.at}</span>
                        </div>
                        <div className="text-gray-900">
                          <span className="uppercase text-xs px-1 py-0.5 rounded bg-gray-100">{a.action}</span>
                          {a.note ? <span className="ml-2">{a.note}</span> : null}
                        </div>
                      </div>
                    </div>
                  ))}
                  {audit.length === 0 && <div className="text-sm text-gray-500">No audit entries yet.</div>}
                </div>
              )}

              {/* APPROVALS */}
              {detailTab === "approvals" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Sequential approvals • Current stage:{" "}
                      <span className="font-medium">{selectedDemand.current_stage ?? selectedDemand.currentStage}</span>
                    </div>
                    {(selectedDemand.current_stage || selectedDemand.currentStage) &&
                      userCanActOnSelected && (
                        <div className="space-x-2">
                          <button onClick={approveSelected} className="px-3 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700">
                            Approve
                          </button>
                          <button onClick={rejectSelected} className="px-3 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700">
                            Reject
                          </button>
                        </div>
                      )}
                  </div>

                  {/* Optional parallel approvers list (only shown if backing API exists) */}
                  <div className="border rounded-md divide-y">
                    {approvals.map((ap) => (
                      <div key={ap.id} className="p-3 flex items-center justify-between">
                        <div className="text-sm">
                          <div className="font-medium">{ap.approver}</div>
                          <div className="text-gray-500 text-xs">
                            Role: {ap.role} {ap.decidedAt ? `• ${ap.decidedAt}` : ""}
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            ap.status === "Approved"
                              ? "bg-green-100 text-green-700"
                              : ap.status === "Rejected"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {ap.status}
                        </span>
                      </div>
                    ))}
                    {approvals.length === 0 && <div className="p-3 text-sm text-gray-500">No approvers configured.</div>}
                  </div>

                  {pendingApprovals.length > 0 && (
                    <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 p-2 rounded">
                      {pendingApprovals.length} parallel approval(s) are still pending for this stage.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t flex justify-end">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DemandManagementSystem;
