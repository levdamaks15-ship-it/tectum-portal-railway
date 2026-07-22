with open('.agents/AGENTS.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the bullet point about receipts
content = content.replace('  - нет записей прихода (receipts)\n', '')

with open('.agents/AGENTS.md', 'w', encoding='utf-8') as f:
    f.write(content)
