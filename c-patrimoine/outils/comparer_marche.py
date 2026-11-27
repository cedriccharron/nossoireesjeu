#!/usr/bin/env python3
"""Compare deux market.json sans tenir compte de la date « generated ». Code de sortie 1 si différents."""
import json
import sys

a, b = (json.load(open(p, encoding="utf-8")) for p in sys.argv[1:3])
same = a.get("areas") == b.get("areas") and a.get("series") == b.get("series")
print("identiques" if same else "différents")
sys.exit(0 if same else 1)
