# build-resume-page.py
# One job: write public/resume.html and public/resume/Kenneth_Bingham_Resume.pdf from Ken's current resume,
# so the site and the downloadable PDF always say the same thing.
# The words live in one place: the AI resume source in Ken's Documents folder (kept off the repo on purpose).
#
#   python build-resume-page.py
import html, os, runpy, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = 'C:/Users/kbingh/Documents/Resume - AI 2026-11/source/build_resume_ai.py'
PDF = 'C:/Users/kbingh/Documents/Resume - AI 2026-11/Kenneth_Bingham_Resume_AI.pdf'
R = runpy.run_path(SOURCE, run_name='read_only')
e = html.escape


def job_html(title, where, dates, bullets):
    items = ''.join(f'<li>{e(b)}</li>' for b in bullets)
    body = f'<ul>{items}</ul>' if items else ''
    return f'<div class="job"><h3>{e(title)}<small>{e(where)} &middot; {e(dates)}</small></h3>{body}</div>'


def project_html(name, text):
    title, _, link = name.partition(', ')
    small = f'<a href="https://{e(link)}">{e(link)}</a>' if link else ''
    return f'<div class="job"><h3>{e(title)}<small>{small}</small></h3><ul><li>{e(text)}</li></ul></div>'


value = ''.join(f'<div class="rule"><h3>{e(a)}</h3><p>{e(b)}</p></div>' for a, b in R['VALUE'])


def split_items(text):
    # Split a skills line on commas that are not inside parentheses.
    items, depth, word = [], 0, ''
    for ch in text:
        depth += (ch == '(') - (ch == ')')
        if ch == ',' and depth == 0:
            items.append(word.strip()); word = ''
        else:
            word += ch
    items.append(word.strip())
    return [i for i in items if i]


skills = ''.join(f'<div><h3>{e(a)}</h3><ul class="chips">' + ''.join(f'<li>{e(x)}</li>' for x in split_items(b)) + '</ul></div>'
                 for a, b in R['SKILLS'])
jobs = ''.join(job_html(*j) for j in R['JOBS'])
projects = ''.join(project_html(n, t) for n, t in R['PROJECTS'])
credentials = ''.join(f'<p>{e(c)}</p>' for c in R['CREDENTIALS'])

page = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Resume: Kenneth W. Bingham, AI Engineer for Agents, Evaluation and Reliability</title>
<meta name="description" content="Resume of Kenneth W. Bingham: AI engineer building agents, tool servers, retrieval and evaluation harnesses, on 15+ years of enterprise Java and Spring Boot, including Air Force systems under DoD change control.">
<meta name="author" content="Kenneth W. Bingham">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://butterflyfx.us/resume.html">
<link rel="icon" href="assets/butterfly.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@700;800&display=swap">
<link rel="stylesheet" href="portfolio.css">
<style>@media print {{ body {{ background: #fff; color: #000; }} .top nav, .cta, .foot {{ display: none; }} .page {{ gap: 24px; padding: 0; }} h1, h2, h3, .prose b, .job ul, .lede, .prose, .rule p {{ color: #000 !important; -webkit-text-fill-color: #000; }} .chips li {{ color: #000; border-color: #999; background: none; }} }}</style>
</head>
<body>
<div class="page">

  <div class="top">
    <a class="brand" href="./"><img src="kennethbingham.webp" alt="" width="42" height="42"><span>Kenneth W. Bingham<small>AI Engineer &middot; Java and Spring Boot</small></span></a>
    <nav aria-label="Site"><a href="./">Work</a><a href="how-i-direct-ai.html">How I direct AI</a><a href="what-i-put-in.html">What I put in</a><a href="resume.html" aria-current="page">Resume</a><a class="hire" href="contact.html">Contact</a></nav>
  </div>

  <header class="split">
    <div class="say">
      <span class="eyebrow">Resume</span>
      <h1 style="font-size: clamp(38px, 4.6vw, 68px)">Kenneth W. Bingham</h1>
      <p class="lede">{e(R['TITLE'])}. St. George, Utah, remote or hybrid.</p>
      <div class="cta"><a class="btn go" href="resume/Kenneth_Bingham_Resume.pdf">Download resume (PDF, 2 pages)</a><a class="btn" href="resume/Kenneth_Bingham_Resume_Full.pdf">Full work history (PDF)</a><a class="btn" href="contact.html">Contact</a><a class="btn" href="https://www.linkedin.com/in/kenneth-bingham-11378b10">LinkedIn</a><a class="btn" href="https://github.com/kenbin64">GitHub</a></div>
    </div>
    <div class="prose"><p>{e(R['SUMMARY'])}</p></div>
  </header>

  <section class="block" aria-labelledby="value-title">
    <h2 id="value-title">What I can do for you</h2>
    <div class="rules">{value}</div>
  </section>

  <section class="block" aria-labelledby="skills-title">
    <h2 id="skills-title">Skills</h2>
    <div class="stack">{skills}</div>
  </section>

  <section class="block" aria-labelledby="proj-title">
    <h2 id="proj-title">AI work and projects</h2>
    <p class="hint">{e(R['PROJECTS_INTRO'])}</p>
    <div class="time">{projects}</div>
  </section>

  <section class="block" aria-labelledby="exp-title">
    <h2 id="exp-title">Experience</h2>
    <div class="time">{jobs}</div>
  </section>

  <section class="split" aria-labelledby="edu-title">
    <h2 id="edu-title">Education, certification and clearance</h2>
    <div class="prose">{credentials}</div>
  </section>

  <footer class="foot hint">
    <div class="row"><span>&copy; 2026 Kenneth W. Bingham &middot; St. George, Utah</span><span><a href="./">Work</a> &middot; <a href="how-i-direct-ai.html">How I direct AI</a> &middot; <a href="contact.html">Contact</a></span></div>
  </footer>

</div>
</body>
</html>
'''
open(os.path.join(HERE, 'public', 'resume.html'), 'w', encoding='utf-8').write(page)
shutil.copyfile(PDF, os.path.join(HERE, 'public', 'resume', 'Kenneth_Bingham_Resume.pdf'))
print('written: public/resume.html and public/resume/Kenneth_Bingham_Resume.pdf')
