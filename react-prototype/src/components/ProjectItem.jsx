export default function ProjectItem({ project }) {
  return (
    <li className="project">
      <h3>{project.name}</h3>
      <p>Status: {project.status}</p>
      <p>Next action: {project.nextAction || 'No next action yet.'}</p>
    </li>
  );
}
