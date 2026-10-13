#!/usr/bin/env python3
"""Runs the add and list cases of tests/fixtures/store.json against hooks/backlog_hook.py.
Prints PASS/FAIL lines like the shell suites; exits 1 on any failure."""
import datetime
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "hooks"))
import backlog_hook as hook  # noqa: E402

TODAY = datetime.date.today().isoformat()


def fill(text):
    return text.replace("<today>", TODAY)


def folder_content(root):
    folder = os.path.join(root, ".backlog")
    if not os.path.isdir(folder):
        return {}
    out = {}
    for name in os.listdir(folder):
        if name != ".lock":
            with open(os.path.join(folder, name), encoding="utf-8") as fh:
                out[name] = fh.read()
    return out


def run(case):
    """Returns None for a case Python does not implement, '' on success, else the problem."""
    with tempfile.TemporaryDirectory() as root:
        root = os.path.realpath(root)
        if case.get("files"):
            os.mkdir(os.path.join(root, ".backlog"))
            for name, content in case["files"].items():
                with open(os.path.join(root, ".backlog", name), "w", encoding="utf-8") as fh:
                    fh.write(content)
        if case["op"] == "add":
            if "refused" in case["expect"]:
                try:
                    hook.add(root, case["branch"], case["text"], case["byClaude"])
                    return "expected a refusal"
                except hook.Refused as exc:
                    if str(exc) != case["expect"]["refused"]:
                        return f"refusal {exc!s}"
            else:
                got = hook.add(root, case["branch"], case["text"], case["byClaude"])
                if got != fill(case["expect"]["marker"]):
                    return f"marker {got!r}"
        elif case["op"] == "list":
            items = case["expect"]["items"]
            want = f"BACKLOG_LIST:\n{hook.numbered(items)}\n{hook.DATA_NOTE}" if items else "BACKLOG_LIST: Backlog is empty."
            got = hook.list_items(root, case.get("tag"))
            if got != want:
                return f"list {got!r}"
        else:
            return None  # done and note exist only in the mod
        want_files = {k: fill(v) for k, v in case["expect"]["files"].items()}
        got_files = folder_content(root)
        if got_files != want_files:
            return f"files {got_files!r}"
    return ""


def main():
    with open(os.path.join(HERE, "fixtures", "store.json"), encoding="utf-8") as fh:
        cases = json.load(fh)
    failed = 0
    for case in cases:
        problem = run(case)
        if problem is None:
            continue
        if problem == "":
            print(f"PASS fixture: {case['name']}")
        else:
            print(f"FAIL fixture: {case['name']}: {problem}")
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
