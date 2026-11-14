"""The fixed v1 school calendar (display periods and actual time slots)."""
PBD = {0: [2,3,4,5,6,7], 1: [1,2,3,4,5,6,7], 2: [1,2,3,4], 3: [1,2,3,4,5,6,7], 4: [1,2,3,4,5,6,7]}
RT = {g: {1:1,2:2,3:3,4:(5 if g == '3' else 4),5:6,6:7,7:8} for g in ('1','2','3')}
CELLS = [(d,p) for d, ps in PBD.items() for p in ps]
DAYS = ['월','화','수','목','금']
