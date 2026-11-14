"""Print cached XLSX cell values as {sheet: rows}; does not calculate formulas."""
import argparse
import json
import sys
import openpyxl

parser = argparse.ArgumentParser()
parser.add_argument('xlsx')
args = parser.parse_args()
sys.stdout.reconfigure(encoding='utf-8')
wb = openpyxl.load_workbook(args.xlsx, read_only=True, data_only=True)
try:
    print(json.dumps({ws.title: list(ws.values) for ws in wb}, ensure_ascii=False, default=str))
finally:
    wb.close()
