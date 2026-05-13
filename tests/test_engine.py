"""Tests for the calculator engine."""
import math

import pytest

from calc.engine import (
    CalcError,
    Calculator,
    convert_base,
    convert_unit,
)


def approx(value, expected, tol=1e-9):
    return abs(value - expected) < tol


def test_arithmetic_basics():
    c = Calculator()
    assert c.evaluate("1 + 2 * 3") == 7
    assert c.evaluate("(1 + 2) * 3") == 9
    assert c.evaluate("2 ** 10") == 1024
    assert c.evaluate("10 // 3") == 3
    assert c.evaluate("10 % 3") == 1


def test_implicit_multiplication():
    c = Calculator()
    assert approx(c.evaluate("2pi"), 2 * math.pi)
    assert c.evaluate("3(1+1)") == 6
    assert approx(c.evaluate("2sin(pi/2)"), 2.0)


def test_trig_modes():
    c = Calculator(angle_mode="rad")
    assert approx(c.evaluate("sin(pi/2)"), 1.0)
    c.set_angle_mode("deg")
    assert approx(c.evaluate("sin(90)"), 1.0)
    assert approx(c.evaluate("cos(0)"), 1.0)


def test_scientific_functions():
    c = Calculator()
    assert approx(c.evaluate("sqrt(16)"), 4.0)
    assert approx(c.evaluate("cbrt(27)"), 3.0)
    assert approx(c.evaluate("root(32, 5)"), 2.0)
    assert approx(c.evaluate("log(1000)"), 3.0)
    assert approx(c.evaluate("ln(e)"), 1.0)
    assert approx(c.evaluate("log(8, 2)"), 3.0)


def test_combinatorics_and_number_theory():
    c = Calculator()
    assert c.evaluate("fact(6)") == 720
    assert c.evaluate("comb(5, 2)") == 10
    assert c.evaluate("perm(5, 2)") == 20
    assert c.evaluate("gcd(54, 24)") == 6
    assert c.evaluate("lcm(6, 8)") == 24
    assert c.evaluate("isprime(97)") is True
    assert c.evaluate("isprime(100)") is False


def test_statistics():
    c = Calculator()
    assert c.evaluate("mean(1,2,3,4)") == 2.5
    assert c.evaluate("median(1,2,3,4,5)") == 3
    assert approx(c.evaluate("stdev(2,4,4,4,5,5,7,9)"), 2.138089935299395)


def test_variables_and_ans():
    c = Calculator()
    c.assign("x", "5")
    assert c.evaluate("x * 2") == 10
    assert c.evaluate("ans + 5") == 15


def test_bit_ops_and_bases():
    c = Calculator()
    assert c.evaluate("0xff & 0x0f") == 0x0f
    assert c.evaluate("1 << 4") == 16
    assert c.evaluate("xor(0b1100, 0b1010)") == 0b0110
    assert c.evaluate("bin(10)") == "0b1010"
    assert c.evaluate("hex(255)") == "0xff"


def test_caret_means_power():
    c = Calculator()
    assert c.evaluate("2^10") == 1024
    assert c.evaluate("5^2 + 1") == 26


def test_complex_numbers():
    c = Calculator()
    result = c.evaluate("(1+2i)*(3+4i)")
    assert result == complex(-5, 10)
    assert approx(c.evaluate("real(3+4i)"), 3.0)
    assert approx(c.evaluate("imag(3+4i)"), 4.0)


def test_conditional_expression():
    c = Calculator()
    assert c.evaluate("10 if 5 > 3 else 20") == 10
    assert c.evaluate("10 if 5 < 3 else 20") == 20


def test_reserved_name_assignment_rejected():
    c = Calculator()
    with pytest.raises(CalcError):
        c.assign("pi", "3")


def test_unknown_name_rejected():
    c = Calculator()
    with pytest.raises(CalcError):
        c.evaluate("foo + 1")


def test_dangerous_syntax_rejected():
    c = Calculator()
    # Attribute access, subscripts, lambdas, comprehensions, walrus...
    for bad in [
        "(1).__class__",
        "[1,2,3][0]",
        "(lambda x: x)(1)",
        "[x for x in range(3)]",
        "__import__('os')",
    ]:
        with pytest.raises(CalcError):
            c.evaluate(bad)


def test_division_by_zero():
    c = Calculator()
    with pytest.raises(CalcError):
        c.evaluate("1/0")


def test_unit_conversion():
    assert approx(convert_unit(1, "km", "m"), 1000.0)
    assert approx(convert_unit(100, "c", "f"), 212.0)
    assert approx(convert_unit(1, "h", "s"), 3600.0)
    assert approx(convert_unit(1, "gb", "mb"), 1024.0)
    with pytest.raises(CalcError):
        convert_unit(1, "km", "kg")


def test_base_conversion():
    assert convert_base("255", 16) == "0xff"
    assert convert_base("0xff", 10) == "255"
    assert convert_base("0b1010", 8) == "0o12"


def test_history_records_expressions():
    c = Calculator()
    c.evaluate("1+1")
    c.evaluate("2*3")
    assert len(c.history) == 2
    assert c.history[-1] == ("2*3", 6)
