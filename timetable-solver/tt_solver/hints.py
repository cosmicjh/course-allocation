"""Soft decision-variable hints; imported placements are never constraints."""
from collections import defaultdict
from .calendar import CELLS


def decisions(slot, y, ban_unit, include_bans=True):
    variables = [v for cells in slot.values() for v in cells.values()] + list(y.values())
    if include_bans:
        for row in ban_unit.values():
            for unit in row['units']:
                variables.extend(unit['cells'].values())
                variables.append(unit['placed'])
    return {v.Name(): v for v in variables}


def capture(solver, slot, y, ban_unit, include_bans=True):
    return {name: solver.Value(v) for name, v in decisions(slot, y, ban_unit, include_bans).items()}


def apply(cm, slot, y, ban_unit, values):
    for name, var in decisions(slot, y, ban_unit).items():
        if name in values:
            cm.AddHint(var, values[name])


def from_result(model, previous, slot, y, ban_unit):
    hint, positions = {}, defaultdict(set)
    source_ids, matched_ids = set(), set()
    for kind, key in (('blocks', 'SEC_PLACE'), ('bans', 'BAN_PLACE')):
        current = {row['rowId']: i for i, row in enumerate(model[kind])}
        for row in previous.get(key, []):
            if not isinstance(row, dict) or not isinstance(row.get('rowId'), str):
                continue
            rid = row['rowId']
            source_ids.add(rid)
            if rid not in current:
                continue
            matched_ids.add(rid)
            d, p = row.get('d'), row.get('p')
            if type(d) is int and type(p) is int and (d, p) in CELLS:
                positions[kind, current[rid]].add((d, p))
    block_cells = defaultdict(dict)
    matching_blocks = {(row['grade'], row['block']) for i, row in enumerate(model['blocks']) if ('blocks', i) in positions}
    for row in previous.get('blockSlots', []):
        if not isinstance(row, dict):
            continue
        g, bc, si, d, p = (row.get(k) for k in ('g', 'block', 'slot', 'd', 'p'))
        if not isinstance(g, str) or not isinstance(bc, str) or type(si) is not int:
            continue
        if (g, bc) in matching_blocks and (g, bc, si) in slot and type(d) is int and type(p) is int and (d, p) in CELLS:
            if (d, p) not in block_cells[g, bc].values():
                block_cells[g, bc].setdefault(si, (d, p))
    # Older result files may have placements but no explicit block-slot array.
    for g, bc in matching_blocks:
        cells = {cell for i, row in enumerate(model['blocks']) if (row['grade'], row['block']) == (g, bc) for cell in positions.get(('blocks', i), set())}
        for cell in sorted(cells - set(block_cells[g, bc].values())):
            free = next((si for gg, block, si in slot if (gg, block) == (g, bc) and si not in block_cells[g, bc]), None)
            if free is not None:
                block_cells[g, bc][free] = cell
    for (g, bc), cells in block_cells.items():
        for si, chosen in cells.items():
            for cell, var in slot[g, bc, si].items():
                hint[var.Name()] = int(cell == chosen)
    for i, row in enumerate(model['blocks']):
        if ('blocks', i) in positions:
            for si, cell in block_cells[row['grade'], row['block']].items():
                hint[y[i, si].Name()] = int(cell in positions['blocks', i])
    for i, row in ban_unit.items():
        for unit, chosen in zip(row['units'], sorted(positions.get(('bans', i), set()))):
            hint[unit['placed'].Name()] = 1
            for cell, var in unit['cells'].items():
                hint[var.Name()] = int(cell == chosen)
    stats = dict(source='previous_result', rowIds=len(source_ids), matchedRowIds=len(matched_ids),
                 ignoredRowIds=len(source_ids - matched_ids), matchRate=len(matched_ids)/len(source_ids) if source_ids else 0,
                 hintedVariables=len(hint))
    return hint, stats


def validate_result(value):
    if not isinstance(value, dict) or not any(key in value for key in ('SEC_PLACE', 'BAN_PLACE')):
        raise ValueError('시작점은 배치 행이 포함된 result.json이어야 합니다.')
    for key in ('SEC_PLACE', 'BAN_PLACE', 'blockSlots'):
        if not isinstance(value.get(key, []), list):
            raise ValueError('시작점 배치와 블록 슬롯은 배열이어야 합니다.')
    return value
