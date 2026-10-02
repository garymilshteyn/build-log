import { useState } from 'react';
import ProjectForm from './components/ProjectForm.jsx';
import ProjectList from './components/ProjectList.jsx';

export default function App() {
  const [projects, setProjects] = useState([]);

  function addProject(fields) {
    const name = fields.name.trim();
    if (!name) return;

    // Generate the ID once, outside the state updater and render cycle.
    const project = { ...fields, name, id: crypto.randomUUID() };
    setProjects((currentProjects) => [...currentProjects, project]);
  }

  return (
    <main className="app">
      <header>
        <p className="eyebrow">React prototype</p>
        <h1>Build Log</h1>
        <p>Track your projects and their next actions. This list resets on refresh.</p>
      </header>
      <ProjectForm onAddProject={addProject} />
      <ProjectList projects={projects} />
    </main>
  );
}
