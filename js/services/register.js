const form = document.getElementById("registerForm");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
	
  // 1. Validação de Senha	
  if (password !== confirmPassword) {
    alert("As senhas não coincidem");
    return;
  }

  // 2. Montagem do Objeto	
  const user = {
    name,
    email,
    password,
    role: "cliente",
	isPending: true
  };
	
try {
    // 3. Chamada ao Serviço
    const result = await AuthService.register(user);
	console.log("RESULTADO REGISTER:", result);

    if (result.success) {
      alert("Usuário criado com sucesso!");
      // 4. Redirecionamento para a tela de login (index.html na raiz)
      window.location.href = "../index.html";
    } else {
      // Exibe erro caso o email já exista, por exemplo
      alert(result.error || "Esse email já é cadastrado");
    }
  } catch (error) {
    console.error("Erro no registro:", error);
    alert("Erro crítico ao acessar o serviço de autenticação.");
  }
});
