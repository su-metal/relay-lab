from pathlib import Path

p = Path("src/circuit/engine/__tests__/s8vm-05024.test.ts")
text = p.read_text()
old = '''      inputVoltageMin: 100,
      inputVoltageMax: 240,
      outputVoltage: 24,'''
new = '''      ratedInputVoltageMin: 100,
      ratedInputVoltageMax: 240,
      allowableInputVoltageMin: 85,
      allowableInputVoltageMax: 265,
      outputVoltage: 24,'''
if old not in text:
    raise SystemExit("S8VM test expectation anchor not found")
p.write_text(text.replace(old, new, 1))
