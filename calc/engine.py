"""Safe expression evaluator and calculator engine.

Supports arithmetic, scientific functions, statistics, combinatorics,
base conversion, complex numbers, variables, and a session history.
The evaluator parses input with ``ast`` and rejects any node type that
is not on an explicit allow-list, so arbitrary code cannot be executed.
"""
from __future__ import annotations

import ast
import cmath
import math
import operator
import re
import statistics
from fractions import Fraction
from typing import Any, Callable


class CalcError(Exception):
    """Raised when an expression cannot be evaluated."""


_BIN_OPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.BitAnd: operator.and_,
    ast.BitOr: operator.or_,
    ast.BitXor: operator.xor,
    ast.LShift: operator.lshift,
    ast.RShift: operator.rshift,
}

_UNARY_OPS: dict[type, Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Invert: operator.invert,
    ast.Not: operator.not_,
}

_CMP_OPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}


def _build_functions() -> dict[str, Callable[..., Any]]:
    """Return the function table exposed to expressions."""

    def _trig(fn: Callable[[float], float]) -> Callable[..., float]:
        def wrapper(x: float, mode: str = "rad") -> float:
            if mode == "deg":
                x = math.radians(x)
            return fn(x)

        return wrapper

    def _inv_trig(fn: Callable[[float], float]) -> Callable[..., float]:
        def wrapper(x: float, mode: str = "rad") -> float:
            result = fn(x)
            if mode == "deg":
                result = math.degrees(result)
            return result

        return wrapper

    def root(x: float, n: float = 2) -> float:
        if n == 0:
            raise CalcError("root: degree must be non-zero")
        if x < 0 and int(n) == n and int(n) % 2 == 1:
            return -((-x) ** (1 / n))
        return x ** (1 / n)

    def log(x: float, base: float = 10) -> float:
        return math.log(x, base)

    def fact(n: int) -> int:
        if isinstance(n, float) and n.is_integer():
            n = int(n)
        if not isinstance(n, int) or n < 0:
            raise CalcError("factorial requires a non-negative integer")
        return math.factorial(n)

    def mean(*args: float) -> float:
        return statistics.fmean(_flatten(args))

    def median(*args: float) -> float:
        return statistics.median(_flatten(args))

    def mode(*args: float) -> float:
        return statistics.mode(_flatten(args))

    def stdev(*args: float) -> float:
        data = list(_flatten(args))
        if len(data) < 2:
            raise CalcError("stdev requires at least 2 values")
        return statistics.stdev(data)

    def variance(*args: float) -> float:
        data = list(_flatten(args))
        if len(data) < 2:
            raise CalcError("variance requires at least 2 values")
        return statistics.variance(data)

    def total(*args: float) -> float:
        return sum(_flatten(args))

    def product(*args: float) -> float:
        result = 1
        for v in _flatten(args):
            result *= v
        return result

    def to_bin(n: int) -> str:
        return bin(int(n))

    def to_hex(n: int) -> str:
        return hex(int(n))

    def to_oct(n: int) -> str:
        return oct(int(n))

    def to_frac(x: float, limit: int = 1_000_000) -> str:
        return str(Fraction(x).limit_denominator(limit))

    def deg(x: float) -> float:
        return math.degrees(x)

    def rad(x: float) -> float:
        return math.radians(x)

    return {
        # arithmetic / general
        "abs": abs,
        "round": round,
        "floor": math.floor,
        "ceil": math.ceil,
        "trunc": math.trunc,
        "sign": lambda x: (x > 0) - (x < 0),
        "min": lambda *a: min(_flatten(a)),
        "max": lambda *a: max(_flatten(a)),
        "sum": total,
        "prod": product,
        # powers / roots / logs
        "sqrt": math.sqrt,
        "cbrt": lambda x: root(x, 3),
        "root": root,
        "exp": math.exp,
        "log": log,
        "ln": math.log,
        "log2": math.log2,
        "log10": math.log10,
        # trig
        "sin": _trig(math.sin),
        "cos": _trig(math.cos),
        "tan": _trig(math.tan),
        "asin": _inv_trig(math.asin),
        "acos": _inv_trig(math.acos),
        "atan": _inv_trig(math.atan),
        "atan2": lambda y, x, mode="rad": (
            math.degrees(math.atan2(y, x)) if mode == "deg" else math.atan2(y, x)
        ),
        "sinh": math.sinh,
        "cosh": math.cosh,
        "tanh": math.tanh,
        "asinh": math.asinh,
        "acosh": math.acosh,
        "atanh": math.atanh,
        "deg": deg,
        "rad": rad,
        # combinatorics / number theory
        "fact": fact,
        "factorial": fact,
        "gcd": math.gcd,
        "lcm": math.lcm,
        "comb": math.comb,
        "perm": math.perm,
        "isprime": _isprime,
        # statistics
        "mean": mean,
        "avg": mean,
        "median": median,
        "mode": mode,
        "stdev": stdev,
        "variance": variance,
        # base / formatting
        "bin": to_bin,
        "hex": to_hex,
        "oct": to_oct,
        "frac": to_frac,
        # bitwise (operators ^ is reserved for power; use xor() for XOR)
        "xor": operator.xor,
        # complex
        "real": lambda z: z.real if isinstance(z, complex) else z,
        "imag": lambda z: z.imag if isinstance(z, complex) else 0.0,
        "phase": cmath.phase,
        "polar": cmath.polar,
        "rect": cmath.rect,
        "conj": lambda z: z.conjugate() if isinstance(z, complex) else z,
    }


def _flatten(args: Any) -> list[Any]:
    """Flatten one level of nested tuples/lists so ``mean([1,2,3])`` works."""
    out: list[Any] = []
    for a in args:
        if isinstance(a, (list, tuple)):
            out.extend(a)
        else:
            out.append(a)
    return out


def _isprime(n: int) -> bool:
    if isinstance(n, float):
        if not n.is_integer():
            return False
        n = int(n)
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0:
        return False
    i = 3
    while i * i <= n:
        if n % i == 0:
            return False
        i += 2
    return True


_CONSTANTS: dict[str, Any] = {
    "pi": math.pi,
    "e": math.e,
    "tau": math.tau,
    "inf": math.inf,
    "nan": math.nan,
    "phi": (1 + math.sqrt(5)) / 2,
    "i": 1j,
    "j": 1j,
    "True": True,
    "False": False,
}


# Unit conversion table: factors are relative to the base unit per category.
_UNITS: dict[str, dict[str, float]] = {
    "length": {
        "m": 1.0, "km": 1000.0, "cm": 0.01, "mm": 0.001, "um": 1e-6, "nm": 1e-9,
        "mi": 1609.344, "yd": 0.9144, "ft": 0.3048, "in": 0.0254,
    },
    "mass": {
        "kg": 1.0, "g": 0.001, "mg": 1e-6, "t": 1000.0,
        "lb": 0.45359237, "oz": 0.028349523125,
    },
    "time": {
        "s": 1.0, "ms": 0.001, "us": 1e-6, "min": 60.0, "h": 3600.0,
        "d": 86400.0, "wk": 604800.0,
    },
    "volume": {
        "l": 1.0, "ml": 0.001, "m3": 1000.0, "cm3": 0.001,
        "gal": 3.785411784, "qt": 0.946352946, "pt": 0.473176473, "cup": 0.2365882365,
    },
    "data": {
        "b": 1.0, "kb": 1024.0, "mb": 1024.0 ** 2, "gb": 1024.0 ** 3,
        "tb": 1024.0 ** 4, "pb": 1024.0 ** 5,
    },
}


def convert_unit(value: float, src: str, dst: str) -> float:
    """Convert ``value`` from ``src`` units to ``dst`` units."""
    src_l, dst_l = src.lower(), dst.lower()
    # Temperature handled specially since it is affine, not linear.
    temp = {"c", "f", "k"}
    if src_l in temp or dst_l in temp:
        if src_l not in temp or dst_l not in temp:
            raise CalcError(f"cannot convert {src} to {dst}")
        return _convert_temperature(value, src_l, dst_l)
    for table in _UNITS.values():
        if src_l in table and dst_l in table:
            return value * table[src_l] / table[dst_l]
    raise CalcError(f"unknown or incompatible units: {src} -> {dst}")


def _convert_temperature(value: float, src: str, dst: str) -> float:
    if src == "c":
        k = value + 273.15
    elif src == "f":
        k = (value - 32) * 5 / 9 + 273.15
    else:
        k = value
    if dst == "c":
        return k - 273.15
    if dst == "f":
        return (k - 273.15) * 9 / 5 + 32
    return k


def convert_base(token: str, base_to: int) -> str:
    """Convert a numeric ``token`` (which may carry a 0x/0o/0b prefix or
    decimal digits) into base 2, 8, 10, or 16."""
    n = int(token, 0) if isinstance(token, str) else int(token)
    if base_to == 2:
        return bin(n)
    if base_to == 8:
        return oct(n)
    if base_to == 10:
        return str(n)
    if base_to == 16:
        return hex(n)
    raise CalcError("supported bases: 2, 8, 10, 16")


class Calculator:
    """Expression-driven calculator with persistent state."""

    def __init__(self, angle_mode: str = "rad") -> None:
        if angle_mode not in ("rad", "deg"):
            raise CalcError("angle_mode must be 'rad' or 'deg'")
        self.angle_mode = angle_mode
        self.variables: dict[str, Any] = {}
        self.history: list[tuple[str, Any]] = []
        self._functions = _build_functions()

    # ---------- public API ----------

    def evaluate(self, expression: str) -> Any:
        """Evaluate an expression and store the result as ``ans``."""
        expression = expression.strip()
        if not expression:
            raise CalcError("empty expression")
        # Calculator-style power: ^ means ** (use xor() for bitwise XOR).
        expression = expression.replace("^", "**")
        # Implicit multiplication: 2pi -> 2*pi, 3(x+1) -> 3*(x+1)
        expression = _insert_implicit_mul(expression)
        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError as exc:
            raise CalcError(f"syntax error: {exc.msg}") from exc
        value = self._eval(tree.body)
        self.variables["ans"] = value
        self.history.append((expression, value))
        return value

    def assign(self, name: str, expression: str) -> Any:
        """Evaluate ``expression`` and bind the result to ``name``."""
        if not name.isidentifier():
            raise CalcError(f"invalid variable name: {name}")
        if name in _CONSTANTS or name in self._functions:
            raise CalcError(f"'{name}' is reserved")
        value = self.evaluate(expression)
        self.variables[name] = value
        return value

    def set_angle_mode(self, mode: str) -> None:
        if mode not in ("rad", "deg"):
            raise CalcError("angle mode must be 'rad' or 'deg'")
        self.angle_mode = mode

    def clear_history(self) -> None:
        self.history.clear()

    def clear_variables(self) -> None:
        self.variables.clear()

    # ---------- evaluator internals ----------

    def _eval(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float, complex, bool, str)):
                return node.value
            raise CalcError(f"unsupported literal: {type(node.value).__name__}")
        if isinstance(node, ast.Name):
            return self._resolve(node.id)
        if isinstance(node, ast.BinOp):
            op = _BIN_OPS.get(type(node.op))
            if op is None:
                raise CalcError(f"operator not allowed: {type(node.op).__name__}")
            try:
                return op(self._eval(node.left), self._eval(node.right))
            except ZeroDivisionError as exc:
                raise CalcError("division by zero") from exc
            except (ValueError, TypeError, OverflowError) as exc:
                raise CalcError(str(exc)) from exc
        if isinstance(node, ast.UnaryOp):
            op = _UNARY_OPS.get(type(node.op))
            if op is None:
                raise CalcError(f"unary operator not allowed: {type(node.op).__name__}")
            return op(self._eval(node.operand))
        if isinstance(node, ast.BoolOp):
            values = [self._eval(v) for v in node.values]
            if isinstance(node.op, ast.And):
                return all(values)
            return any(values)
        if isinstance(node, ast.Compare):
            left = self._eval(node.left)
            for op_node, right_node in zip(node.ops, node.comparators):
                op = _CMP_OPS.get(type(op_node))
                if op is None:
                    raise CalcError(f"comparison not allowed: {type(op_node).__name__}")
                right = self._eval(right_node)
                if not op(left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.IfExp):
            return self._eval(node.body) if self._eval(node.test) else self._eval(node.orelse)
        if isinstance(node, ast.Call):
            return self._call(node)
        if isinstance(node, ast.Tuple):
            return tuple(self._eval(el) for el in node.elts)
        if isinstance(node, ast.List):
            return [self._eval(el) for el in node.elts]
        raise CalcError(f"unsupported syntax: {type(node).__name__}")

    def _resolve(self, name: str) -> Any:
        if name in self.variables:
            return self.variables[name]
        if name in _CONSTANTS:
            return _CONSTANTS[name]
        if name in self._functions:
            return self._functions[name]
        raise CalcError(f"unknown name: {name}")

    def _call(self, node: ast.Call) -> Any:
        if not isinstance(node.func, ast.Name):
            raise CalcError("only direct function calls are allowed")
        fname = node.func.id
        if fname not in self._functions:
            raise CalcError(f"unknown function: {fname}")
        func = self._functions[fname]
        args = [self._eval(a) for a in node.args]
        kwargs = {kw.arg: self._eval(kw.value) for kw in node.keywords if kw.arg}
        if fname in {"sin", "cos", "tan", "asin", "acos", "atan", "atan2"}:
            kwargs.setdefault("mode", self.angle_mode)
        try:
            return func(*args, **kwargs)
        except CalcError:
            raise
        except ZeroDivisionError as exc:
            raise CalcError("division by zero") from exc
        except (ValueError, TypeError, OverflowError) as exc:
            raise CalcError(f"{fname}: {exc}") from exc


_KEYWORDS = frozenset({"if", "else", "and", "or", "not", "in", "is", "True", "False", "None"})


def _peek_identifier(expression: str, start: int) -> str:
    j = start
    while j < len(expression) and (expression[j].isalnum() or expression[j] == "_"):
        j += 1
    return expression[start:j]


def _insert_implicit_mul(expression: str) -> str:
    """Insert ``*`` between a number/closing paren and a name or ``(``.

    Skips numeric literals wholesale (``0x..``, ``0o..``, ``0b..``, ``1e5``) and
    skips keyword identifiers so that ``10 if 5 > 3 else 20`` stays intact.
    """
    out: list[str] = []
    i = 0
    n = len(expression)
    while i < n:
        ch = expression[i]
        if ch.isdigit() or (ch == "." and i + 1 < n and expression[i + 1].isdigit()):
            j = i
            if ch == "0" and i + 1 < n and expression[i + 1] in "xXoObB":
                j += 2
                while j < n and expression[j].isalnum():
                    j += 1
            else:
                while j < n and (expression[j].isdigit() or expression[j] in ".eE"):
                    if expression[j] in "eE" and j + 1 < n and expression[j + 1] in "+-":
                        j += 2
                        continue
                    j += 1
            out.append(expression[i:j])
            i = j
            k = j
            while k < n and expression[k].isspace():
                k += 1
            if k < n and (expression[k].isalpha() or expression[k] == "_"):
                if _peek_identifier(expression, k) not in _KEYWORDS:
                    out.append("*")
            elif k < n and expression[k] == "(":
                out.append("*")
            continue
        if ch == ")":
            out.append(ch)
            i += 1
            k = i
            while k < n and expression[k].isspace():
                k += 1
            if k < n and (expression[k].isalpha() or expression[k] == "_"):
                if _peek_identifier(expression, k) not in _KEYWORDS:
                    out.append("*")
            elif k < n and expression[k] == "(":
                out.append("*")
            continue
        out.append(ch)
        i += 1
    return "".join(out)
