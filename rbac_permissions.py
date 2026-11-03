"""
Tectum Enterprise Portal — Role & Permission Based Access Control (RBAC/PBAC)
Centralized permission definitions, capability mappings and route access policies.
"""
from typing import Dict, List, Set, Optional

# Core Permission Definitions
PERMISSION_SHIFT_REPORT_EDIT = "shift.report.edit"
PERMISSION_SHIFT_DOWNTIME_RECORD = "shift.downtime.record"
PERMISSION_SHIFT_CREW_PLAN_VIEW = "shift.crew_plan.view"

PERMISSION_DOWNTIMES_AUDIT_VIEW = "downtimes.audit.view"
PERMISSION_DOWNTIMES_CLASSIFY = "downtimes.classify"
PERMISSION_DOWNTIMES_EXPORT_SHEETS = "downtimes.export.sheets"

PERMISSION_NORMS_VIEW = "norms.view"
PERMISSION_NORMS_EDIT = "norms.edit"

PERMISSION_KPI_SUMMARY_VIEW = "kpi.summary.view"
PERMISSION_REPORTS_EXPORT_SHEETS = "reports.export.sheets"

PERMISSION_QUALITY_SORTING_EDIT = "quality.sorting.edit"
PERMISSION_QUALITY_ACTS_VIEW = "quality.acts.view"

PERMISSION_LKC_REPORT_EDIT = "lkc.report.edit"
PERMISSION_LKC_DOWNTIMES_RECORD = "lkc.downtimes.record"

PERMISSION_PORTAL_TASKS_VIEW = "portal.tasks.view"

# Mapping Roles to Capabilities
ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "master": [
        PERMISSION_SHIFT_REPORT_EDIT,
        PERMISSION_SHIFT_DOWNTIME_RECORD,
        PERMISSION_SHIFT_CREW_PLAN_VIEW,
        PERMISSION_KPI_SUMMARY_VIEW,
    ],
    "technologist": [
        PERMISSION_DOWNTIMES_AUDIT_VIEW,
        PERMISSION_DOWNTIMES_CLASSIFY,
        PERMISSION_DOWNTIMES_EXPORT_SHEETS,
        PERMISSION_NORMS_VIEW,
        PERMISSION_NORMS_EDIT,
        PERMISSION_KPI_SUMMARY_VIEW,
    ],
    "director": [
        PERMISSION_SHIFT_CREW_PLAN_VIEW,
        PERMISSION_DOWNTIMES_AUDIT_VIEW,
        PERMISSION_NORMS_VIEW,
        PERMISSION_KPI_SUMMARY_VIEW,
        PERMISSION_REPORTS_EXPORT_SHEETS,
    ],
    "mechanic": [
        PERMISSION_SHIFT_DOWNTIME_RECORD,
        PERMISSION_DOWNTIMES_AUDIT_VIEW,
    ],
    "production_head": [
        PERMISSION_SHIFT_REPORT_EDIT,
        PERMISSION_SHIFT_DOWNTIME_RECORD,
        PERMISSION_SHIFT_CREW_PLAN_VIEW,
        PERMISSION_DOWNTIMES_AUDIT_VIEW,
        PERMISSION_NORMS_VIEW,
        PERMISSION_KPI_SUMMARY_VIEW,
        PERMISSION_REPORTS_EXPORT_SHEETS,
    ],
    "tech_director": [
        PERMISSION_DOWNTIMES_AUDIT_VIEW,
        PERMISSION_DOWNTIMES_CLASSIFY,
        PERMISSION_DOWNTIMES_EXPORT_SHEETS,
        PERMISSION_NORMS_VIEW,
        PERMISSION_NORMS_EDIT,
        PERMISSION_KPI_SUMMARY_VIEW,
        PERMISSION_REPORTS_EXPORT_SHEETS,
    ],
    "qcd": [
        PERMISSION_QUALITY_SORTING_EDIT,
        PERMISSION_QUALITY_ACTS_VIEW,
        PERMISSION_KPI_SUMMARY_VIEW,
    ],
    "lkc_master": [
        PERMISSION_LKC_REPORT_EDIT,
        PERMISSION_LKC_DOWNTIMES_RECORD,
    ],
    "portal": [
        PERMISSION_PORTAL_TASKS_VIEW,
    ],
    "admin": [
        "*",  # Wildcard full access to all capabilities
    ],
}

def get_role_permissions(role: Optional[str]) -> List[str]:
    """
    Returns list of permission strings granted to the given role.
    Admin gets wildcard '*' granting all operations.
    """
    if not role:
        return []
    clean_role = role.strip().lower()
    if clean_role == "admin":
        return ["*"]
    return ROLE_PERMISSIONS.get(clean_role, [])

def has_permission(user_permissions: List[str], required_permission: str) -> bool:
    """
    Checks if given user permissions satisfy the required capability.
    Supports wildcard '*' permission for administrators.
    """
    if not user_permissions:
        return False
    if "*" in user_permissions:
        return True
    return required_permission in user_permissions
