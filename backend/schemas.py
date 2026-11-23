"""Pydantic v2 request schemas compatible with Python 3.9 typing."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    display_name: str = Field(..., min_length=1, max_length=48)
    password: str = Field(..., min_length=4, max_length=128)
    avatar_color: Optional[str] = Field(default="#FF6B57", max_length=16)


class LoginRequest(BaseModel):
    username: str
    password: str


class BlockExerciseInput(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    default_increment: float = Field(default=2.5, gt=0, le=50)


class BlockCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    duration_days: Optional[int] = Field(default=None, ge=7, le=365)
    duration_weeks: Optional[int] = Field(default=14, ge=1, le=52)
    track_bodyweight: bool = True
    weekly_session_goal: int = Field(default=3, ge=1, le=14)
    exercises: Optional[List[BlockExerciseInput]] = None


class BlockUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    status: Optional[str] = Field(default=None, pattern=r"^(active|archived)$")
    weekly_session_goal: Optional[int] = Field(default=None, ge=1, le=14)
    track_bodyweight: Optional[bool] = None
    add_exercises: Optional[List[BlockExerciseInput]] = None
    exercise_tracking: Optional[Dict[int, bool]] = None


class ExerciseTargetInput(BaseModel):
    block_exercise_id: int
    plan_type: Optional[str] = None
    target_metric: str = Field(default="working_weight", pattern=r"^(working_weight|one_rm)$")
    start_weight: float = Field(..., ge=0, le=1000)
    goal_weight: float = Field(..., ge=0, le=1000)
    increment: float = Field(default=2.5, gt=0, le=50)
    config: Dict[str, Any] = Field(default_factory=dict)


class MemberPlanUpsertRequest(BaseModel):
    plan_type: str = Field(default="linear", pattern=r"^(linear|531|1rm_everyday|gzclp|custom)$")
    plan_name: Optional[str] = Field(default=None, max_length=80)
    bodyweight_start: Optional[float] = Field(default=None, gt=20, le=400)
    bodyweight_goal: Optional[float] = Field(default=None, gt=20, le=400)
    targets: List[ExerciseTargetInput] = Field(default_factory=list)


class PlanPreviewRequest(BaseModel):
    plan_type: str = Field(default="linear", pattern=r"^(linear|531|1rm_everyday|gzclp|custom)$")
    start_weight: float = Field(..., ge=0, le=1000)
    goal_weight: float = Field(..., ge=0, le=1000)
    increment: float = Field(default=2.5, gt=0, le=50)
    config: Dict[str, Any] = Field(default_factory=dict)


class SetEntry(BaseModel):
    weight: float = Field(..., ge=0, le=1000)
    reps: int = Field(..., ge=1, le=100)
    rpe: Optional[float] = Field(default=None, ge=1, le=10)


class WorkoutLogCreateRequest(BaseModel):
    block_exercise_id: int
    log_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    working_weight: Optional[float] = Field(default=None, ge=0, le=1000)
    one_rm: Optional[float] = Field(default=None, ge=0, le=1000)
    sets: Optional[List[SetEntry]] = None
    notes: str = Field(default="", max_length=500)


class WorkoutLogUpdateRequest(BaseModel):
    log_date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    working_weight: Optional[float] = Field(default=None, ge=0, le=1000)
    one_rm: Optional[float] = Field(default=None, ge=0, le=1000)
    sets: Optional[List[SetEntry]] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class BodyweightLogRequest(BaseModel):
    log_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    weight: float = Field(..., gt=20, le=400)
    notes: str = Field(default="", max_length=300)
