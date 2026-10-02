import { useState } from 'react';

export default function ProjectForm({ onAddProject }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('In progress');
  const [nextAction, setNextAction] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter a project name. Spaces alone do not count.');
      return;
    }

    onAddProject({ name: name.trim(), status, nextAction: nextAction.trim() });
    setName('');
    setStatus('In progress');
    setNextAction('');
    setError('');
  }

  return (
    <section className="panel" aria-labelledby="form-heading">
      <h2 id="form-heading">Add project</h2>
      <form onSubmit={handleSubmit}>
        <label htmlFor="project-name">Project name</label>
        <input
          id="project-name"
          required
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'name-error' : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError('');
          }}
        />
        {error && <p id="name-error" className="error" role="alert">{error}</p>}

        <label htmlFor="project-status">Status</label>
        <select id="project-status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option>Planned</option>
          <option>In progress</option>
          <option>Done</option>
        </select>

        <label htmlFor="next-action">Next action (optional)</label>
        <input id="next-action" value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
        <button type="submit">Add project</button>
      </form>
    </section>
  );
}
