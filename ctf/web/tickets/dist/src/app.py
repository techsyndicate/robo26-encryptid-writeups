from flask import Flask, request, render_template

app = Flask(__name__)
FLAG = "encryptid{...}"

BLACKLIST = [
    '__', 'import', 'globals', 'subprocess', 'open', 'chr', 'getattr',
    'lambda', 'read', 'eval', 'exec', 'compile', 'vars', 'dir', 'print',
    'input', 'type', 'help', 'VVIP_COUPON', 'locals', 'builtins', 'os',
    'sys', '\\', 'breakpoint', 'license', 'credits', 'quit', 'exit',
    'setattr', 'delattr', 'format_map', 'bytes', 'bytearray',
    'memoryview', 'super', 'classmethod', 'staticmethod', 'property',
    'coupon'
]
MAX_LEN = 400

def _build_checker():
    secret = open('/app/coupon.txt', 'r').read().strip()
    def check(value):
        return value == secret
    return check

checker = _build_checker()

@app.route('/', methods=['GET'])
def render_index():
    return render_template('index.html')

@app.route('/book', methods=['GET', 'POST'])
def generate_ticket():
    from flask import send_file
    from io import BytesIO
    from random import randint
    if request.method == 'POST':
        name = request.form.get('name', 'Anonymous')
        level = request.form.get('level', 'Regular')
        ticket_id = str(randint(1, 100000))
        ticket_dict = {
            "id": ticket_id,
            "name": name,
            "level": level
        }
        ticket_data = str(ticket_dict)
        return send_file(
            BytesIO(ticket_data.encode()),
            as_attachment=True,
            download_name=f"ticket.tkt",
            mimetype='text/plain'
        )

    return render_template('book.html')

@app.route('/checkin', methods=['GET', 'POST'])
def validate_ticket():
    if request.method == 'POST':
        ticket_file = request.files.get('ticket')
        if ticket_file:
            content = ticket_file.read().decode()
            try:
                if not content.isascii():
                    return f"<p>ASCII only. Cute try, though.</p>"
                if len(content) > MAX_LEN:
                    return f"<p>Ticket too large to verify.</p>"
                for word in BLACKLIST:
                    if word in content:
                        return f"Hacking attempt detected. Touch some grass >:("

                ticket = eval(content)
                if "coupon" in ticket:
                    if checker(ticket['coupon']):
                        return f"""
                        <h1>Welcome, Master.</h1>
                        <p>Please accept this gift of ours: {FLAG}"""
                return """
                <h1>Verified!</h1>
                <p>You are now checked in.</p>"""
            except Exception as e:
                print(e)
                return f"<p>Invalid ticket.</p>"

    return render_template('checkin.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
