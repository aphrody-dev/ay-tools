"""Reference evaluation of a DEPS file with depot_tools' own gclient_eval, to compare with `ay-deps list`.

The reference is the real code at the commit pinned in ay-tools.toml (tools/reference.ts fetch depot_tools): gclient_eval.Parse expands
the variables and standardizes the dependencies, gclient_eval.EvaluateCondition decides every condition, and the built-in variables are
the ones of gclient.py (Dependency.get_builtin_vars).
  python3 parity_deps.py <depot_tools dir> <DEPS> <host_os> <host_cpu> <target_os> <target_cpu> [name=value ...]
"""

import json
import sys

depot_tools, path, host_os, host_cpu, target_os, target_cpu, *pairs = sys.argv[1:]
sys.path.insert(0, depot_tools)
import gclient_eval  # noqa: E402
import gclient_utils  # noqa: E402

OSES = ["android", "chromeos", "fuchsia", "ios", "linux", "mac", "win"]
CPUS = ["arm", "arm64", "x86", "mips", "mips64", "ppc", "riscv64", "s390", "x64", "loong64"]

builtin = {"checkout_" + name: name == target_os for name in OSES}
builtin.update({"checkout_" + name: name == target_cpu for name in CPUS})
builtin.update(host_os=host_os, host_cpu=host_cpu)
overrides = {}
for pair in pairs:
    name, value = pair.split("=", 1)
    overrides[name] = {"True": True, "False": False}.get(value, value)

parsed = gclient_eval.Parse(open(path, encoding="utf8").read(), path, vars_override=overrides, builtin_vars=builtin)

# The variables of a checkout, in gclient's order of precedence: the file's, then the built-in ones, then the overrides of existing names.
variables = dict(parsed.get("vars", {}))
variables.update(builtin)
variables.update({name: value for name, value in overrides.items() if name in variables})


def applies(entry):
    condition = entry.get("condition")
    return True if not condition else bool(gclient_eval.EvaluateCondition(condition, variables))


deps = []
for dep_path, entry in parsed.get("deps", {}).items():
    if not applies(entry):
        continue
    kind = entry.get("dep_type", "git")
    if kind == "git":
        url, rev = gclient_utils.SplitUrlRevision(entry["url"])
        item = {"path": dep_path, "type": "git", "url": url, "rev": rev}
    elif kind == "cipd":
        item = {"path": dep_path, "type": "cipd", "packages": ["%s@%s" % (p["package"], p["version"] if "version" in p else "file:" + p["version_file"]) for p in entry["packages"]]}
    else:
        item = {"path": dep_path, "type": kind, "objects": len(entry.get("objects", []))}
    deps.append(item)

hooks = [{"name": hook.get("name", ""), "action": list(hook.get("action", []))} for hook in parsed.get("hooks", []) if applies(hook)]
print(json.dumps({"deps": deps, "hooks": hooks, "recursedeps": list(parsed.get("recursedeps", []))}, sort_keys=True))
