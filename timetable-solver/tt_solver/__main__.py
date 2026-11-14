import argparse
from pathlib import Path
import sys
from .runner import read_json, run


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='backslashreplace')
    sys.stderr.reconfigure(encoding='utf-8', errors='backslashreplace')
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    cli = sub.add_parser('run')
    cli.add_argument('--model', required=True)
    cli.add_argument('--out', required=True)
    cli.add_argument('--options')
    cli.add_argument('--limits', default='1800,600,120')
    cli.add_argument('--start-limit', type=float, help='실험적 0단계 제한 초 (기본 0: 생략)')
    cli.add_argument('--warm-start', help='이전 result.json을 1단계 시작점으로 사용')
    for command in ('serve','open'):
        server = sub.add_parser(command)
        server.add_argument('--port', type=int, default=8765)
        server.add_argument('--runs', default=str(Path(__file__).resolve().parents[1]/'runs'))
    args = parser.parse_args()
    if args.command == 'run':
        limits = tuple(float(x) for x in args.limits.split(','))
        result = run(read_json(args.model), read_json(args.options) if args.options else {}, args.out, limits,
                     warm_start=read_json(args.warm_start) if args.warm_start else None, start_limit=args.start_limit)
        print(result['status'])
        return 0 if result['status'] == 'SUCCESS' else 1
    from .server import serve
    serve(args.port, args.runs, args.command == 'open')
    return 0


if __name__ == '__main__':
    sys.exit(main())
