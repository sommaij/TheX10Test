"""Interactive REPL and one-shot CLI for the advanced calculator."""
from __future__ import annotations

import argparse
import sys

from .engine import CalcError, Calculator, convert_base, convert_unit


HELP_TEXT = """\
Commands
  :help                show this help
  :quit / :exit        exit the REPL
  :mode deg|rad        switch trigonometry mode (current: {mode})
  :vars                list user variables
  :history [N]         show last N entries (default 20)
  :clear vars|history  clear stored state
  :conv <v> <a> <b>    convert value: e.g.  :conv 10 km mi
  :base <n> <b>        show n in base b (2|8|10|16). Prefix 0x/0o/0b for input.

Assignment
  x = 2 * pi           bind a variable; result also stored in `ans`

Expressions
  arithmetic   + - * / // % **  bit-ops & | ^ ~ << >>  comparisons
  constants    pi e tau phi inf i (or j) for complex
  functions    sin cos tan asin acos atan atan2  sinh cosh tanh ...
               sqrt cbrt root(x,n) exp log(x[,base]) ln log2 log10
               abs round floor ceil trunc sign min max sum prod
               fact gcd lcm comb perm isprime
               mean median mode stdev variance
               bin hex oct frac(x[,limit])
               real imag phase polar rect conj
  implicit *   2pi, 3(x+1), and 2sin(pi/4) all work
"""


def _format(value: object) -> str:
    if isinstance(value, float):
        if value.is_integer() and abs(value) < 1e16:
            return f"{int(value)}"
        return f"{value:.12g}"
    if isinstance(value, complex):
        return f"{value.real:.12g}{value.imag:+.12g}i"
    return str(value)


def _handle_command(calc: Calculator, line: str) -> bool:
    """Return True if the line was a colon-command (handled)."""
    if not line.startswith(":"):
        return False
    parts = line[1:].split()
    if not parts:
        return True
    cmd, *args = parts
    if cmd in ("quit", "exit", "q"):
        raise SystemExit(0)
    if cmd == "help":
        print(HELP_TEXT.format(mode=calc.angle_mode))
        return True
    if cmd == "mode":
        if not args or args[0] not in ("deg", "rad"):
            print("usage: :mode deg|rad")
            return True
        calc.set_angle_mode(args[0])
        print(f"angle mode: {calc.angle_mode}")
        return True
    if cmd == "vars":
        if not calc.variables:
            print("(no variables)")
        else:
            for name, val in calc.variables.items():
                print(f"  {name} = {_format(val)}")
        return True
    if cmd == "history":
        n = int(args[0]) if args else 20
        for i, (expr, val) in enumerate(calc.history[-n:], 1):
            print(f"  [{i}] {expr} = {_format(val)}")
        return True
    if cmd == "clear":
        what = args[0] if args else ""
        if what == "vars":
            calc.clear_variables()
            print("variables cleared")
        elif what == "history":
            calc.clear_history()
            print("history cleared")
        else:
            print("usage: :clear vars|history")
        return True
    if cmd == "conv":
        if len(args) != 3:
            print("usage: :conv <value> <from-unit> <to-unit>")
            return True
        try:
            value = float(args[0])
            result = convert_unit(value, args[1], args[2])
            print(f"{value} {args[1]} = {_format(result)} {args[2]}")
        except (CalcError, ValueError) as exc:
            print(f"error: {exc}")
        return True
    if cmd == "base":
        if len(args) != 2:
            print("usage: :base <number> <2|8|10|16>")
            return True
        try:
            print(convert_base(args[0], int(args[1])))
        except (CalcError, ValueError) as exc:
            print(f"error: {exc}")
        return True
    print(f"unknown command: :{cmd}  (try :help)")
    return True


def _process_line(calc: Calculator, raw: str) -> None:
    line = raw.strip()
    if not line or line.startswith("#"):
        return
    if _handle_command(calc, line):
        return
    # Assignment: name = expr  (but not == comparisons)
    if "=" in line and "==" not in line:
        name, _, expr = line.partition("=")
        name = name.strip()
        if name.isidentifier():
            value = calc.assign(name, expr)
            print(f"{name} = {_format(value)}")
            return
    value = calc.evaluate(line)
    print(_format(value))


def repl(calc: Calculator) -> int:
    print("Advanced Calculator  (type :help for commands, :quit to exit)")
    while True:
        try:
            raw = input(f"calc[{calc.angle_mode}]> ")
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        try:
            _process_line(calc, raw)
        except CalcError as exc:
            print(f"error: {exc}")
        except SystemExit:
            return 0
        except Exception as exc:  # noqa: BLE001 - last-resort guard for REPL UX
            print(f"error: {exc}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="calc",
        description="Advanced calculator with REPL and one-shot modes.",
    )
    parser.add_argument(
        "expression",
        nargs="*",
        help="evaluate a single expression and exit (omit to start REPL)",
    )
    parser.add_argument(
        "--deg",
        action="store_true",
        help="use degrees for trigonometry (default: radians)",
    )
    args = parser.parse_args(argv)
    calc = Calculator(angle_mode="deg" if args.deg else "rad")
    if args.expression:
        try:
            _process_line(calc, " ".join(args.expression))
            return 0
        except CalcError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    return repl(calc)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
