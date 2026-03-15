const form = document.getElementById("registerForm");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    alert("As senhas não coincidem");
    return;
  }

  const user = {
    name,
    email,
    password,
    role: "cliente"
  };

  const result = await AuthService.register(user);

  if (result.success) {
    alert("Usuário criado com sucesso!");
    window.location.href = "../index.html";
  } else {
    alert(result.error || "Erro ao cadastrar");
  }
});