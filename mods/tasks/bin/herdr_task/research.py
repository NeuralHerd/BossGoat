"""Research checkpoints belong to the task, independently of its agent or space."""

import os
from .base import Fail, now


def configure(task, args):
    if getattr(args, "research", False) and not task.get("research"):
        if task.get("state") not in ("todo", "queued", "scheduled") or task.get("agents") or task.get("worktree"):
            raise Fail("Research mode can only be selected before the task starts.")
        task["research"] = True
    if not task.get("research"):
        return
    if getattr(args, "worktree", False) or getattr(args, "base", None) or getattr(args, "branch", None):
        raise Fail("Research tasks use the existing folder without a worktree or branch.")
    task["mode"] = "here"
    for key in ("branch", "base", "base_set", "base_by"):
        task.pop(key, None)


def report_path(store, task):
    return os.path.join(os.path.dirname(store.path), "research", store.slug, f"{task['id']}.md")


def report_text(task):
    notes = task.get("research_notes") or {}
    parts = ["# " + task["title"], "## Question", notes.get("question") or task.get("prompt") or task["title"]]
    for key, title in (("findings", "Findings"), ("sources", "Sources"), ("open_questions", "Open questions"), ("next_steps", "Next steps")):
        parts += ["## " + title, notes.get(key) or "None recorded yet."]
    return "\n\n".join(parts) + "\n"


def checkpoint(store, task, args):
    if not task.get("research"):
        raise Fail("Checkpoints are for research tasks; select --research before starting.")
    if task.get("state") == "done":
        raise Fail("Reopen this research task before updating its findings.")
    values = {key: getattr(args, key, None) for key in ("findings", "sources", "open_questions", "next_steps")}
    if not any(value is not None for value in values.values()):
        raise Fail("Provide --findings, --sources, --open-questions or --next-steps.")
    notes = dict(task.get("research_notes") or {"question": task.get("prompt") or task["title"]})
    notes.update({key: value.strip() for key, value in values.items() if value is not None})
    updated = {**task, "research_notes": notes}
    path = report_path(store, task)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(report_text(updated))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    task.update(research_notes=notes, research_report=path, research_updated=now())
    store.dirty = True


def instructions(store, task, ht, folder):
    path = report_path(store, task)
    return ("You are researching one question. Read and compare evidence; distinguish verified facts, inferences and unknowns. "
            "Keep the repository and external systems read-only. Do not implement, commit, push, create a worktree or open a pull request. "
            "Repository instructions still apply within this research scope. Any implementation needs a separate task.\n"
            f"Your durable report is {path}. If it exists, read it before continuing, including after a restart. "
            "Save an initial checkpoint before investigating and update it after each meaningful finding, at least every five minutes, "
            "and before asking a question or stopping. Never keep the only copy in chat. "
            "Each supplied field replaces that section; carry forward earlier useful findings and sources. "
            "Include source URLs or file paths, what they support, unresolved questions, and the next concrete steps.\n"
            f"Save with `{ht} checkpoint {store.ref(task)} --folder {folder} --findings '<findings so far>' "
            "--sources '<sources with evidence>' --open-questions '<unresolved questions or none>' --next-steps '<next steps or complete>'`. "
            "The command saves outside the repository and returns the report path. "
            "Finish with a short summary and a link to that report; do not copy the full research transcript to the Assistant. "
            "Say ready only after saving your findings and sources. The person accepts it; never mark it done yourself.")
