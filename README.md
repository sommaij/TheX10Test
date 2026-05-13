# Advanced Calculator

A safe, batteries-included calculator with an interactive REPL and a one-shot
CLI. Expressions are parsed with Python's `ast` and evaluated through an
explicit allow-list, so arbitrary code cannot run.

## Quick start

```bash
# REPL
python -m calc

# One-shot
python -m calc "2 + 3 * sin(pi/2)"
python -m calc --deg "sin(30)"
```

## Features

- Arithmetic: `+ - * / // % ** ^` (`^` means power; use `xor()` for bitwise XOR)
- Bitwise: `& | ~ << >>`, plus `xor(a, b)`
- Constants: `pi`, `e`, `tau`, `phi`, `inf`, `nan`, `i`/`j` (complex)
- Scientific: `sqrt`, `cbrt`, `root(x, n)`, `exp`, `log(x[, base])`, `ln`,
  `log2`, `log10`
- Trig (degree or radian mode): `sin cos tan asin acos atan atan2`
  and hyperbolic `sinh cosh tanh asinh acosh atanh`; convert with `deg(x)` /
  `rad(x)`
- Combinatorics / number theory: `fact`, `gcd`, `lcm`, `comb`, `perm`,
  `isprime`
- Statistics: `mean`, `median`, `mode`, `stdev`, `variance`, `sum`, `prod`,
  `min`, `max`
- Base conversion: `bin(n)`, `hex(n)`, `oct(n)`, plus `:base` REPL command
- Complex: `real`, `imag`, `phase`, `polar`, `rect`, `conj`
- Variables: `x = 2 * pi`; the last result is stored in `ans`
- Implicit multiplication: `2pi`, `3(x+1)`, `2sin(pi/4)`

## REPL commands

| Command | Description |
| --- | --- |
| `:help` | List commands and built-ins |
| `:mode deg\|rad` | Switch trigonometry mode |
| `:vars` | List user variables |
| `:history [N]` | Show last N entries |
| `:clear vars\|history` | Clear stored state |
| `:conv <v> <from> <to>` | Unit conversion (length, mass, time, volume, data, temperature) |
| `:base <n> <2\|8\|10\|16>` | Convert a number between bases |
| `:quit` | Exit |

## Examples

```
calc[rad]> 2pi
6.283185307180
calc[rad]> :mode deg
angle mode: deg
calc[deg]> sin(30)
0.5
calc[deg]> x = comb(52, 5)
x = 2598960
calc[deg]> :conv 100 c f
100.0 c = 212 f
calc[deg]> :base 0xff 2
0b11111111
```

## Tests

```bash
pip install pytest
python -m pytest
```
